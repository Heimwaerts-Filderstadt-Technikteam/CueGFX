// CueGFX DeckLink – Implementierung
#include "dl_engine.h"
#include "pixel.h"
#include <chrono>
#include <cmath>
#include <cstdio>

namespace cuedl {

template <class T> static void SafeRelease(T*& p) { if (p) { p->Release(); p = nullptr; } }

static std::string Hr(const char* what, HRESULT hr) {
  char buf[160];
  snprintf(buf, sizeof(buf), "%s (Fehlercode 0x%08X)", what, (unsigned)hr);
  return buf;
}

static void CollectModes(IDeckLinkDisplayModeIterator* it, std::vector<ModeInfo>& out) {
  if (!it) return;
  IDeckLinkDisplayMode* mode = nullptr;
  while (it->Next(&mode) == S_OK) {
    ModeInfo m;
    m.code = (uint32_t)mode->GetDisplayMode();
    m.id = FourCC(m.code);
    m.width = (int)mode->GetWidth();
    m.height = (int)mode->GetHeight();
    DLString name = nullptr;
    if (mode->GetName(&name) == S_OK) { m.name = DLToStd(name); DLFree(name); }
    BMDTimeValue dur = 0; BMDTimeScale scale = 0;
    if (mode->GetFrameRate(&dur, &scale) == S_OK && dur > 0) m.fps = std::round((double)scale / (double)dur * 100.0) / 100.0;
    m.interlaced = mode->GetFieldDominance() == bmdLowerFieldFirst || mode->GetFieldDominance() == bmdUpperFieldFirst;
    out.push_back(m);
    mode->Release();
  }
}

std::vector<DeviceInfo> ListDevices(std::string* error) {
  std::vector<DeviceInfo> list;
  IDeckLinkIterator* it = DLCreateIterator();
  if (!it) { if (error) *error = "Blackmagic Desktop Video ist nicht installiert (DeckLink-Treiber nicht gefunden)"; return list; }
  IDeckLink* dl = nullptr;
  int index = 0;
  while (it->Next(&dl) == S_OK) {
    DeviceInfo d;
    d.index = index;
    DLString s = nullptr;
    if (dl->GetDisplayName(&s) == S_OK) { d.name = DLToStd(s); DLFree(s); }
    s = nullptr;
    if (dl->GetModelName(&s) == S_OK) { d.model = DLToStd(s); DLFree(s); }
    if (d.name.empty()) d.name = d.model.empty() ? "DeckLink" : d.model;

    IDeckLinkProfileAttributes* attr = nullptr;
    if (dl->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK && attr) {
      DLBool flag = false;
      if (attr->GetFlag(BMDDeckLinkSupportsExternalKeying, &flag) == S_OK) d.externalKeying = flag ? true : false;
      flag = false;
      if (attr->GetFlag(BMDDeckLinkSupportsInternalKeying, &flag) == S_OK) d.internalKeying = flag ? true : false;
      flag = false;
      if (attr->GetFlag(BMDDeckLinkSupportsInputFormatDetection, &flag) == S_OK) d.formatDetection = flag ? true : false;
      DLInt64 v = 0;
      if (attr->GetInt(BMDDeckLinkPersistentID, &v) == S_OK) { d.persistentId = (int64_t)v; d.hasPersistentId = true; }
      v = 0;
      if (attr->GetInt(BMDDeckLinkVideoIOSupport, &v) == S_OK) {
        d.canInput = (v & bmdDeviceSupportsCapture) != 0;
        d.canOutput = (v & bmdDeviceSupportsPlayback) != 0;
      }
      attr->Release();
    }
    IDeckLinkOutput* out = nullptr;
    if (dl->QueryInterface(IID_IDeckLinkOutput, (void**)&out) == S_OK && out) {
      d.canOutput = true;
      IDeckLinkDisplayModeIterator* mi = nullptr;
      if (out->GetDisplayModeIterator(&mi) == S_OK) { CollectModes(mi, d.outputModes); mi->Release(); }
      out->Release();
    } else d.canOutput = false;
    IDeckLinkInput* in = nullptr;
    if (dl->QueryInterface(IID_IDeckLinkInput, (void**)&in) == S_OK && in) {
      d.canInput = true;
      IDeckLinkDisplayModeIterator* mi = nullptr;
      if (in->GetDisplayModeIterator(&mi) == S_OK) { CollectModes(mi, d.inputModes); mi->Release(); }
      in->Release();
    } else d.canInput = false;

    char key[96];
    if (d.hasPersistentId) snprintf(key, sizeof(key), "pid:%llx", (unsigned long long)d.persistentId);
    else snprintf(key, sizeof(key), "idx:%d", index);
    d.key = key;
    list.push_back(d);
    dl->Release();
    ++index;
  }
  it->Release();
  return list;
}

std::string DriverVersion() {
  IDeckLinkAPIInformation* info = DLCreateApiInfo();
  if (!info) return "";
  std::string v;
  DLString s = nullptr;
  if (info->GetString(BMDDeckLinkAPIVersion, &s) == S_OK) { v = DLToStd(s); DLFree(s); }
  info->Release();
  return v;
}

IDeckLink* OpenDevice(int index) {
  if (index < 0) return nullptr;
  IDeckLinkIterator* it = DLCreateIterator();
  if (!it) return nullptr;
  IDeckLink* dl = nullptr;
  IDeckLink* found = nullptr;
  int i = 0;
  while (it->Next(&dl) == S_OK) {
    if (i++ == index) { found = dl; break; }
    dl->Release();
  }
  it->Release();
  return found;
}

static bool FindMode(IDeckLinkDisplayModeIterator* it, uint32_t code, int* w, int* h, BMDTimeValue* dur, BMDTimeScale* scale, std::string* name) {
  IDeckLinkDisplayMode* mode = nullptr;
  bool ok = false;
  while (it->Next(&mode) == S_OK) {
    if ((uint32_t)mode->GetDisplayMode() == code) {
      *w = (int)mode->GetWidth(); *h = (int)mode->GetHeight();
      mode->GetFrameRate(dur, scale);
      DLString s = nullptr;
      if (mode->GetName(&s) == S_OK) { *name = DLToStd(s); DLFree(s); }
      ok = true;
    }
    mode->Release();
    if (ok) break;
  }
  return ok;
}

/* ===================== InputCapture ===================== */

InputCapture::InputCapture() {}
InputCapture::~InputCapture() { Stop(); }

bool InputCapture::Start(int deviceIndex, uint32_t preferredMode, int outW, int outH, std::string* error) {
  outW_ = outW; outH_ = outH;
  bg_.assign((size_t)outW * outH * 4, 0);
  for (size_t i = 3; i < bg_.size(); i += 4) bg_[i] = 255;
  device_ = OpenDevice(deviceIndex);
  if (!device_) { *error = "Eingangsgerät nicht gefunden"; return false; }
  if (device_->QueryInterface(IID_IDeckLinkInput, (void**)&input_) != S_OK || !input_) { input_ = nullptr; *error = "Gerät hat keinen Videoeingang"; Stop(); return false; }
  IDeckLinkProfileAttributes* attr = nullptr;
  if (device_->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK && attr) {
    DLBool f = false;
    if (attr->GetFlag(BMDDeckLinkSupportsInputFormatDetection, &f) == S_OK) detection_ = f ? true : false;
    attr->Release();
  }
  input_->SetCallback(this);
  BMDVideoInputFlags flags = detection_ ? bmdVideoInputEnableFormatDetection : bmdVideoInputFlagDefault;
  HRESULT hr = input_->EnableVideoInput((BMDDisplayMode)preferredMode, pixFmt_, flags);
  if (hr != S_OK) { *error = Hr("Eingang konnte nicht aktiviert werden – Format/Gerät belegt?", hr); Stop(); return false; }
  {
    IDeckLinkDisplayModeIterator* it = nullptr;
    if (input_->GetDisplayModeIterator(&it) == S_OK) {
      int w, h; BMDTimeValue d; BMDTimeScale s; std::string n;
      if (FindMode(it, preferredMode, &w, &h, &d, &s, &n)) { std::lock_guard<std::mutex> l(mtx_); modeName_ = n; }
      it->Release();
    }
  }
  hr = input_->StartStreams();
  if (hr != S_OK) { *error = Hr("Eingangs-Stream konnte nicht gestartet werden", hr); Stop(); return false; }
  return true;
}

void InputCapture::Stop() {
  if (input_) {
    input_->StopStreams();
    input_->DisableVideoInput();
    input_->SetCallback(nullptr);
  }
  SafeRelease(input_);
  SafeRelease(device_);
  signal_ = false;
}

std::string InputCapture::ModeName() { std::lock_guard<std::mutex> l(mtx_); return modeName_; }

bool InputCapture::CopyLatest(uint8_t* dst) {
  std::lock_guard<std::mutex> l(mtx_);
  if (bg_.empty()) return false;
  memcpy(dst, bg_.data(), bg_.size());
  return signal_.load();
}

HRESULT InputCapture::VideoInputFormatChanged(BMDVideoInputFormatChangedEvents events, IDeckLinkDisplayMode* mode, BMDDetectedVideoInputFormatFlags flags) {
  if (!input_ || !mode) return S_OK;
  BMDPixelFormat pf = (flags & bmdDetectedVideoInputRGB444) ? bmdFormat8BitARGB : bmdFormat8BitYUV;
  if (!(events & (bmdVideoInputDisplayModeChanged | bmdVideoInputColorspaceChanged)) && pf == pixFmt_) return S_OK;
  pixFmt_ = pf;
  input_->PauseStreams();
  input_->EnableVideoInput(mode->GetDisplayMode(), pixFmt_, bmdVideoInputEnableFormatDetection);
  DLString s = nullptr;
  if (mode->GetName(&s) == S_OK) { std::lock_guard<std::mutex> l(mtx_); modeName_ = DLToStd(s); DLFree(s); }
  input_->FlushStreams();
  input_->StartStreams();
  return S_OK;
}

HRESULT InputCapture::VideoInputFrameArrived(IDeckLinkVideoInputFrame* frame, IDeckLinkAudioInputPacket*) {
  if (!frame) return S_OK;
  const bool noSignal = (frame->GetFlags() & bmdFrameHasNoInputSource) != 0;
  signal_ = !noSignal;
  if (noSignal) return S_OK;
  const int w = (int)frame->GetWidth(), h = (int)frame->GetHeight(), rb = (int)frame->GetRowBytes();
  const BMDPixelFormat pf = frame->GetPixelFormat();
  FrameAccess acc(frame, false);
  if (!acc.bytes) return S_OK;
  std::lock_guard<std::mutex> l(mtx_);
  if (pf == bmdFormat8BitYUV) cuepx::UyvyToBgraScaled((const uint8_t*)acc.bytes, w, h, rb, bg_.data(), outW_, outH_, h >= 720);
  else if (pf == bmdFormat8BitARGB) cuepx::ArgbToBgraScaled((const uint8_t*)acc.bytes, w, h, rb, bg_.data(), outW_, outH_);
  else if (pf == bmdFormat8BitBGRA) {
    for (int y = 0; y < outH_; ++y) {
      const uint8_t* row = (const uint8_t*)acc.bytes + (size_t)((int64_t)y * h / outH_) * rb;
      uint32_t* out = (uint32_t*)(bg_.data() + (size_t)y * outW_ * 4);
      for (int x = 0; x < outW_; ++x) out[x] = ((const uint32_t*)row)[(int64_t)x * w / outW_] | 0xff000000u;
    }
  }
  frames_++;
  return S_OK;
}

/* ===================== OutputEngine ===================== */

OutputEngine::OutputEngine(const OutputConfig& cfg) : cfg_(cfg) {}
OutputEngine::~OutputEngine() { Stop(); }

void OutputEngine::Fail(const std::string& msg) {
  std::lock_guard<std::mutex> l(mtx_);
  status_.error = msg;
}

bool OutputEngine::Start() {
  if (running_) return true;
  { std::lock_guard<std::mutex> l(mtx_); status_ = OutputStatus(); }
  device_ = OpenDevice(cfg_.deviceIndex);
  if (!device_) { Fail("DeckLink-Gerät nicht gefunden (Index " + std::to_string(cfg_.deviceIndex) + ")"); return false; }
  if (device_->QueryInterface(IID_IDeckLinkOutput, (void**)&output_) != S_OK || !output_) { output_ = nullptr; Fail("Gerät unterstützt keine Ausgabe"); Release_(); return false; }

  std::string modeName;
  {
    IDeckLinkDisplayModeIterator* it = nullptr;
    if (output_->GetDisplayModeIterator(&it) != S_OK) { Fail("Videoformate konnten nicht gelesen werden"); Release_(); return false; }
    const bool ok = FindMode(it, cfg_.modeCode, &width_, &height_, &frameDuration_, &timeScale_, &modeName);
    it->Release();
    if (!ok || frameDuration_ <= 0) { Fail("Videoformat " + FourCC(cfg_.modeCode) + " wird von diesem Gerät nicht unterstützt"); Release_(); return false; }
  }
  hd_ = height_ >= 720;

  if (cfg_.keying == KeyExternal || cfg_.keying == KeyInternal) {
    if (device_->QueryInterface(IID_IDeckLinkKeyer, (void**)&keyer_) != S_OK || !keyer_) {
      keyer_ = nullptr;
      Fail(cfg_.keying == KeyExternal ? "Dieses Gerät unterstützt kein externes Keying (Fill+Key). Bei Karten mit Profilen ggf. im Desktop Video Setup ein Profil mit Keying wählen." : "Dieses Gerät unterstützt keinen internen Keyer");
      Release_(); return false;
    }
  }

  HRESULT hr = output_->EnableVideoOutput((BMDDisplayMode)cfg_.modeCode, bmdVideoOutputFlagDefault);
  if (hr != S_OK) { Fail(Hr("Ausgabe konnte nicht aktiviert werden – wird das Gerät von einer anderen Anwendung verwendet?", hr)); Release_(); return false; }

  if (keyer_) {
    hr = keyer_->Enable(cfg_.keying == KeyExternal ? (DLBool)1 : (DLBool)0);
    if (hr != S_OK) { Fail(Hr("Keyer konnte nicht aktiviert werden", hr)); output_->DisableVideoOutput(); Release_(); return false; }
    keyer_->SetLevel((uint8_t)std::max(0, std::min(255, cfg_.keyLevel)));
  }

  if (cfg_.keying == KeySoftware) {
    if (cfg_.inputDeviceIndex < 0) { Fail("Kein Eingangsgerät für den Live-Hintergrund gewählt"); output_->DisableVideoOutput(); Release_(); return false; }
    capture_ = new InputCapture();
    std::string err;
    if (!capture_->Start(cfg_.inputDeviceIndex, cfg_.inputModeCode ? cfg_.inputModeCode : cfg_.modeCode, width_, height_, &err)) {
      Fail("Live-Eingang: " + err); delete capture_; capture_ = nullptr; output_->DisableVideoOutput(); Release_(); return false;
    }
  }

  // Pixelformat prüfen: manche Geräte (z. B. UltraStudio Monitor 3G, Mini Monitor) geben nur YUV aus
  auto supports = [&](BMDPixelFormat f) -> bool {
    DLBool ok = false; BMDDisplayMode actual = (BMDDisplayMode)cfg_.modeCode;
    const HRESULT r = output_->DoesSupportVideoMode(bmdVideoConnectionUnspecified, (BMDDisplayMode)cfg_.modeCode, f, bmdNoVideoOutputConversion, bmdSupportedVideoModeDefault, &actual, &ok);
    return r != S_OK || ok;  // Bei Abfragefehler annehmen, dass es geht
  };
  const BMDPixelFormat order[3] = { bmdFormat8BitBGRA, bmdFormat8BitARGB, bmdFormat8BitYUV };
  const PixFmt orderPf[3] = { PixBGRA, PixARGB, PixYUV };
  if (cfg_.pixelFormat == PixAuto || !supports(cfg_.pixelFormat == PixARGB ? bmdFormat8BitARGB : cfg_.pixelFormat == PixYUV ? bmdFormat8BitYUV : bmdFormat8BitBGRA)) {
    PixFmt chosen = PixYUV;
    for (int i = 0; i < 3; ++i) if (supports(order[i])) { chosen = orderPf[i]; break; }
    cfg_.pixelFormat = chosen;
  }
  if (cfg_.pixelFormat == PixYUV && (cfg_.keying == KeyExternal || cfg_.keying == KeyInternal)) {
    Fail("Dieses Gerät gibt nur YUV aus – Keying mit Alpha ist darüber nicht möglich. Keying auf \"Nur Fill\" stellen.");
    if (keyer_) keyer_->Disable();
    output_->DisableVideoOutput(); Release_(); return false;
  }
  BMDPixelFormat pf = cfg_.pixelFormat == PixARGB ? bmdFormat8BitARGB : cfg_.pixelFormat == PixYUV ? bmdFormat8BitYUV : bmdFormat8BitBGRA;
  { std::lock_guard<std::mutex> l(mtx_); status_.pixelFormat = cfg_.pixelFormat == PixARGB ? "ARGB" : cfg_.pixelFormat == PixYUV ? "YUV 4:2:2" : "BGRA"; }
  rowBytes_ = cfg_.pixelFormat == PixYUV ? width_ * 2 : width_ * 4;
  {
    std::lock_guard<std::mutex> l(mtx_);
    graphic_.assign((size_t)width_ * height_ * 4, 0);
  }
  work_.assign((size_t)width_ * height_ * 4, 0);
  bg_.assign((size_t)width_ * height_ * 4, 0);

  const int count = std::max(2, std::min(8, cfg_.preroll));
  for (int i = 0; i < count; ++i) {
    IDeckLinkMutableVideoFrame* f = nullptr;
    hr = output_->CreateVideoFrame(width_, height_, rowBytes_, pf, bmdFrameFlagDefault, &f);
    if (hr != S_OK || !f) { Fail(Hr("Videoframes konnten nicht angelegt werden (Pixelformat nicht unterstützt?)", hr)); Stop(); return false; }
    frames_.push_back(f);
  }

  {
    std::lock_guard<std::mutex> l(mtx_);
    status_.width = width_; status_.height = height_;
    status_.fps = std::round((double)timeScale_ / (double)frameDuration_ * 100.0) / 100.0;
    status_.modeName = modeName;
  }

  if (cfg_.syncMode) {
    // Direkte Ausgabe: ein eigener Thread übergibt jedes Frame synchron an die Karte
    sync_ = true;
    running_ = true;
    { std::lock_guard<std::mutex> l(mtx_); status_.running = true; status_.outputMode = "sync"; }
    worker_ = std::thread([this] { WorkerLoop(); });
    return true;
  }

  output_->SetScheduledFrameCompletionCallback(this);
  sync_ = false;
  running_ = true;
  nextTime_ = 0;
  for (int i = 0; i < count; ++i) {
    FillFrame(frames_[i]);
    hr = output_->ScheduleVideoFrame(frames_[i], nextTime_, frameDuration_, timeScale_);
    if (hr != S_OK) { Fail(Hr("Frame konnte nicht eingeplant werden – Pixelformat für dieses Gerät ungeeignet? Unter Pixelformat ein anderes wählen.", hr)); Stop(); return false; }
    nextTime_ += frameDuration_;
  }
  hr = output_->StartScheduledPlayback(0, timeScale_, 1.0);
  if (hr != S_OK) {
    // Manche Geräte/Treiber verweigern Scheduled Playback – dann direkt ausgeben
    output_->SetScheduledFrameCompletionCallback(nullptr);
    sync_ = true;
    { std::lock_guard<std::mutex> l(mtx_); status_.running = true; status_.outputMode = "sync-fallback"; }
    worker_ = std::thread([this] { WorkerLoop(); });
    return true;
  }
  { std::lock_guard<std::mutex> l(mtx_); status_.running = true; status_.outputMode = "scheduled"; }
  // Wächter: kommen keine Rückmeldungen der Karte, wird automatisch auf direkte Ausgabe umgeschaltet
  worker_ = std::thread([this] { WorkerLoop(); });
  return true;
}

bool OutputEngine::SwitchToSync(const char* why) {
  if (sync_) return true;
  sync_ = true;  // zuerst setzen, damit laufende Callbacks nichts mehr einplanen
  if (output_) {
    BMDTimeValue actual = 0;
    output_->StopScheduledPlayback(0, &actual, timeScale_ ? timeScale_ : 1);
    output_->SetScheduledFrameCompletionCallback(nullptr);
  }
  std::lock_guard<std::mutex> l(mtx_);
  status_.outputMode = "sync-fallback";
  (void)why;
  return true;
}

void OutputEngine::WorkerLoop() {
  using clock = std::chrono::steady_clock;
  const auto period = std::chrono::microseconds(timeScale_ > 0 ? (int64_t)(frameDuration_ * 1000000LL / timeScale_) : 20000);
  auto lastChange = clock::now();
  uint64_t lastCb = callbacks_.load();
  size_t idx = 0;
  auto next = clock::now();
  while (running_) {
    if (!sync_) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
      const uint64_t cb = callbacks_.load();
      if (cb != lastCb) { lastCb = cb; lastChange = clock::now(); continue; }
      if (clock::now() - lastChange > std::chrono::milliseconds(1500)) { SwitchToSync("keine Rückmeldung"); next = clock::now(); }
      continue;
    }
    {
      std::lock_guard<std::mutex> l(schedMtx_);
      if (!running_ || frames_.empty() || !output_) break;
      IDeckLinkMutableVideoFrame* f = frames_[idx++ % frames_.size()];
      FillFrame(f);
      const HRESULT hr = output_->DisplayVideoFrameSync(f);
      std::lock_guard<std::mutex> l2(mtx_);
      if (hr == S_OK) status_.completed++; else status_.dropped++;
    }
    next += period;
    const auto now = clock::now();
    if (next < now - period * 4) next = now;  // nach Hängern nicht nachholen
    std::this_thread::sleep_until(next);
  }
}

void OutputEngine::ScheduleNext(IDeckLinkVideoFrame* frame, bool catchUp) {
  if (sync_) return;
  std::lock_guard<std::mutex> l(schedMtx_);
  if (!running_ || !output_ || sync_) return;
  if (catchUp) {
    // Rückstand aufholen: nächsten Zeitpunkt an die Hardware-Uhr koppeln
    BMDTimeValue streamTime = 0; double speed = 0;
    if (output_->GetScheduledStreamTime(timeScale_, &streamTime, &speed) == S_OK) {
      const BMDTimeValue minNext = (streamTime / frameDuration_ + 2) * frameDuration_;
      if (nextTime_ < minNext) nextTime_ = minNext;
    }
  }
  FillFrame(frame);
  if (output_->ScheduleVideoFrame(frame, nextTime_, frameDuration_, timeScale_) == S_OK) nextTime_ += frameDuration_;
}

HRESULT OutputEngine::ScheduledFrameCompleted(IDeckLinkVideoFrame* frame, BMDOutputFrameCompletionResult result) {
  callbacks_++;
  {
    std::lock_guard<std::mutex> l(mtx_);
    if (result == bmdOutputFrameCompleted) status_.completed++;
    else if (result == bmdOutputFrameDisplayedLate) status_.late++;
    else if (result == bmdOutputFrameDropped) status_.dropped++;
    else if (result == bmdOutputFrameFlushed) status_.flushed++;
  }
  if (!running_ || sync_ || result == bmdOutputFrameFlushed) return S_OK;
  ScheduleNext(frame, result == bmdOutputFrameDisplayedLate || result == bmdOutputFrameDropped);
  return S_OK;
}

void OutputEngine::FillFrame(IDeckLinkVideoFrame* frame) {
  FrameAccess acc(frame, true);
  if (!acc.bytes) return;
  const size_t px = (size_t)width_ * height_;
  // Ziel bei BGRA direkt der Frame-Puffer, sonst Arbeitspuffer
  uint8_t* dst = (cfg_.pixelFormat == PixBGRA && rowBytes_ == width_ * 4) ? (uint8_t*)acc.bytes : work_.data();
  // Mit Live-Eingang: letztes Eingangsbild (ohne Signal bleibt das letzte Bild bzw. Schwarz stehen)
  const bool haveBg = capture_ != nullptr;
  if (haveBg) capture_->CopyLatest(bg_.data());
  {
    std::lock_guard<std::mutex> l(mtx_);
    if (haveBg) cuepx::CompositeOver(graphic_.data(), bg_.data(), dst, px);
    else memcpy(dst, graphic_.data(), px * 4);
    if (capture_) status_.inputSignal = capture_->HasSignal();
  }
  if (!haveBg) {
    if (cfg_.keying == KeyNone || cfg_.pixelFormat == PixYUV) cuepx::ForceOpaque(dst, px);  // vormultipliert über Schwarz = korrektes Fill
    else if (cfg_.straightAlpha) cuepx::Unpremultiply(dst, px);
  }
  if (cfg_.swapRB) cuepx::SwapRB(dst, px);
  if (cfg_.pixelFormat == PixARGB) cuepx::BgraToArgb(dst, (uint8_t*)acc.bytes, width_, height_, rowBytes_);
  else if (cfg_.pixelFormat == PixYUV) cuepx::BgraToUyvy(dst, (uint8_t*)acc.bytes, width_, height_, rowBytes_, hd_);
}

void OutputEngine::PushFrame(const uint8_t* bgra, int w, int h) {
  if (!running_ || w <= 0 || h <= 0) return;
  std::lock_guard<std::mutex> l(mtx_);
  if (graphic_.size() != (size_t)width_ * height_ * 4) return;
  cuepx::BgraScaled(bgra, w, h, graphic_.data(), width_, height_);
  status_.pushed++;
}

OutputStatus OutputEngine::Status() {
  std::lock_guard<std::mutex> l(mtx_);
  OutputStatus s = status_;
  s.running = running_.load() && status_.running;
  if (capture_) { s.inputSignal = capture_->HasSignal(); s.inputMode = capture_->ModeName(); }
  return s;
}

void OutputEngine::Stop() {
  const bool was = running_.exchange(false);
  if (worker_.joinable()) worker_.join();
  if (output_) {
    if (was && !sync_) {
      BMDTimeValue actual = 0;
      output_->StopScheduledPlayback(0, &actual, timeScale_ ? timeScale_ : 1);
    }
    output_->SetScheduledFrameCompletionCallback(nullptr);
    if (keyer_) keyer_->Disable();
    output_->DisableVideoOutput();
  }
  {
    std::lock_guard<std::mutex> l(mtx_);
    status_.running = false;
  }
  Release_();
}

void OutputEngine::Release_() {
  std::lock_guard<std::mutex> l(schedMtx_);
  for (auto* f : frames_) if (f) f->Release();
  frames_.clear();
  if (capture_) { capture_->Stop(); delete capture_; capture_ = nullptr; }
  SafeRelease(keyer_);
  SafeRelease(output_);
  SafeRelease(device_);
}

}  // namespace cuedl
