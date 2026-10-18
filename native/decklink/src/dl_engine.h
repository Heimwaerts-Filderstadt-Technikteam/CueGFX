// CueGFX DeckLink – Geräte, Ausgabe (Scheduled Playback, Keyer) und Live-Eingang
#pragma once

#include "dl_platform.h"
#include <atomic>
#include <mutex>
#include <thread>
#include <string>
#include <vector>

#ifndef E_POINTER
  #define E_POINTER_ E_NOINTERFACE
#else
  #define E_POINTER_ E_POINTER
#endif

namespace cuedl {

struct ModeInfo {
  uint32_t code = 0;
  std::string id, name;
  int width = 0, height = 0;
  double fps = 0;
  bool interlaced = false;
};

struct DeviceInfo {
  int index = -1;
  std::string name, model, key;
  int64_t persistentId = 0;
  bool hasPersistentId = false;
  bool canOutput = false, canInput = false, externalKeying = false, internalKeying = false, formatDetection = false;
  std::vector<ModeInfo> outputModes, inputModes;
};

std::vector<DeviceInfo> ListDevices(std::string* error);
std::string DriverVersion();
IDeckLink* OpenDevice(int index);

enum Keying { KeyNone = 0, KeyExternal = 1, KeyInternal = 2, KeySoftware = 3 };
enum PixFmt { PixBGRA = 0, PixARGB = 1, PixYUV = 2, PixAuto = 3 };

/* Liest einen DeckLink-Eingang ein und hält das letzte Bild als BGRA in Ausgabegröße bereit */
class InputCapture : public IDeckLinkInputCallback {
 public:
  InputCapture();
  ~InputCapture();
  bool Start(int deviceIndex, uint32_t preferredMode, int outW, int outH, std::string* error);
  void Stop();
  // Kopiert den letzten Hintergrund nach dst (outW*outH*4). Gibt false zurück, wenn kein Signal anliegt.
  bool CopyLatest(uint8_t* dst);
  bool HasSignal() const { return signal_.load(); }
  std::string ModeName();
  uint64_t Frames() const { return frames_.load(); }

  // IUnknown – Lebensdauer wird von CueGFX verwaltet, der Zähler dient nur dem Treiber
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, LPVOID* ppv) override {
    if (!ppv) return E_POINTER_;
    if (DLIsIUnknown(iid) || DLSameIID(iid, IID_IDeckLinkInputCallback)) { *ppv = static_cast<IDeckLinkInputCallback*>(this); AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)++refs_; }
  ULONG STDMETHODCALLTYPE Release() override { return (ULONG)--refs_; }
  // IDeckLinkInputCallback
  HRESULT STDMETHODCALLTYPE VideoInputFormatChanged(BMDVideoInputFormatChangedEvents events, IDeckLinkDisplayMode* mode, BMDDetectedVideoInputFormatFlags flags) override;
  HRESULT STDMETHODCALLTYPE VideoInputFrameArrived(IDeckLinkVideoInputFrame* frame, IDeckLinkAudioInputPacket* audio) override;

 private:
  IDeckLink* device_ = nullptr;
  IDeckLinkInput* input_ = nullptr;
  BMDPixelFormat pixFmt_ = bmdFormat8BitYUV;
  bool detection_ = false;
  int outW_ = 0, outH_ = 0;
  std::mutex mtx_;
  std::vector<uint8_t> bg_;
  std::string modeName_;
  std::atomic<bool> signal_{false};
  std::atomic<uint64_t> frames_{0};
  std::atomic<long> refs_{1};
};

struct OutputConfig {
  int deviceIndex = -1;
  uint32_t modeCode = 0;
  Keying keying = KeyNone;
  int keyLevel = 255;
  int inputDeviceIndex = -1;
  uint32_t inputModeCode = 0;
  PixFmt pixelFormat = PixBGRA;
  bool straightAlpha = false;
  bool swapRB = false;
  int preroll = 3;
  bool syncMode = false;   // true = direkte Ausgabe (DisplayVideoFrameSync) statt Scheduled Playback
};

struct OutputStatus {
  bool running = false;
  std::string error, modeName, inputMode;
  int width = 0, height = 0;
  double fps = 0;
  uint64_t completed = 0, late = 0, dropped = 0, flushed = 0, pushed = 0;
  bool inputSignal = false;
  std::string outputMode;  // "scheduled" | "sync" | "sync-fallback"
  std::string pixelFormat; // tatsächlich verwendetes Pixelformat
};

/* Gibt Grafik-Frames per Scheduled Playback aus, optional mit Keyer oder Live-Hintergrund */
class OutputEngine : public IDeckLinkVideoOutputCallback {
 public:
  explicit OutputEngine(const OutputConfig& cfg);
  ~OutputEngine();
  bool Start();
  void Stop();
  void PushFrame(const uint8_t* bgra, int w, int h);
  OutputStatus Status();
  int Width() const { return width_; }
  int Height() const { return height_; }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, LPVOID* ppv) override {
    if (!ppv) return E_POINTER_;
    if (DLIsIUnknown(iid) || DLSameIID(iid, IID_IDeckLinkVideoOutputCallback)) { *ppv = static_cast<IDeckLinkVideoOutputCallback*>(this); AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)++refs_; }
  ULONG STDMETHODCALLTYPE Release() override { return (ULONG)--refs_; }
  HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(IDeckLinkVideoFrame* frame, BMDOutputFrameCompletionResult result) override;
  HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }

 private:
  void Fail(const std::string& msg);
  void Release_();
  void FillFrame(IDeckLinkVideoFrame* frame);
  void ScheduleNext(IDeckLinkVideoFrame* frame, bool catchUp);
  void WorkerLoop();
  bool SwitchToSync(const char* why);

  OutputConfig cfg_;
  IDeckLink* device_ = nullptr;
  IDeckLinkOutput* output_ = nullptr;
  IDeckLinkKeyer* keyer_ = nullptr;
  InputCapture* capture_ = nullptr;
  std::vector<IDeckLinkMutableVideoFrame*> frames_;
  int width_ = 0, height_ = 0, rowBytes_ = 0;
  BMDTimeValue frameDuration_ = 0;
  BMDTimeScale timeScale_ = 0;
  BMDTimeValue nextTime_ = 0;
  bool hd_ = true;
  std::mutex mtx_;            // schützt graphic_ und Status
  std::mutex schedMtx_;       // serialisiert Scheduling
  std::vector<uint8_t> graphic_, work_, bg_;
  std::atomic<bool> running_{false};
  std::atomic<bool> sync_{false};
  std::atomic<long> refs_{1};
  std::atomic<uint64_t> callbacks_{0};
  std::thread worker_;
  OutputStatus status_;
};

}  // namespace cuedl
