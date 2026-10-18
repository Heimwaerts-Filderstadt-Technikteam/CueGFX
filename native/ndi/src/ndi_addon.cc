// CueGFX NDI-Ausgabe – Node-API-Addon.
// Benötigt zum Bauen KEIN NDI SDK: Die NDI-Laufzeit (aus „NDI Tools“ bzw. „NDI Runtime“) wird zur Laufzeit
// dynamisch geladen; die wenigen verwendeten Strukturen entsprechen der öffentlichen NDI-6-C-Schnittstelle.
// NDI® ist eine eingetragene Marke von Vizrt NDI AB.

#include <node_api.h>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <algorithm>
#include <cctype>

#if defined(_WIN32)
  #ifndef NOMINMAX
    #define NOMINMAX
  #endif
  #include <windows.h>
  typedef HMODULE LibHandle;
  static LibHandle LibOpen(const std::string& p) {
    int n = MultiByteToWideChar(CP_UTF8, 0, p.c_str(), -1, nullptr, 0);
    std::wstring w(n, L'\0'); MultiByteToWideChar(CP_UTF8, 0, p.c_str(), -1, &w[0], n);
    return LoadLibraryExW(w.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  }
  static void* LibSym(LibHandle h, const char* s) { return (void*)GetProcAddress(h, s); }
  static std::string LibError() { return "Windows-Fehler " + std::to_string((unsigned long)GetLastError()); }
  static bool FileExists(const std::string& p) { DWORD a = GetFileAttributesA(p.c_str()); return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY); }
#else
  #include <dlfcn.h>
  #include <dirent.h>
  #include <sys/stat.h>
  typedef void* LibHandle;
  static LibHandle LibOpen(const std::string& p) { return dlopen(p.c_str(), RTLD_NOW | RTLD_LOCAL); }
  static void* LibSym(LibHandle h, const char* s) { return dlsym(h, s); }
  static std::string LibError() { const char* e = dlerror(); return e ? e : ""; }
  static bool FileExists(const std::string& p) { struct stat st; return stat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode); }
#endif

/* ---------- Minimale NDI-Deklarationen (ABI der NDI-6-C-Schnittstelle) ---------- */
namespace ndi {
typedef void* send_instance_t;
struct send_create_t { const char* p_ndi_name; const char* p_groups; bool clock_video; bool clock_audio; };
struct video_frame_v2_t {
  int xres, yres;
  uint32_t FourCC;            // enum, int-groß
  int frame_rate_N, frame_rate_D;
  float picture_aspect_ratio;
  int frame_format_type;      // enum, int-groß
  int64_t timecode;
  uint8_t* p_data;
  int line_stride_in_bytes;   // union mit data_size_in_bytes
  const char* p_metadata;
  int64_t timestamp;
};
struct tally_t { bool on_program; bool on_preview; };
constexpr uint32_t FourCC(char a, char b, char c, char d) { return (uint32_t)(uint8_t)a | ((uint32_t)(uint8_t)b << 8) | ((uint32_t)(uint8_t)c << 16) | ((uint32_t)(uint8_t)d << 24); }
constexpr uint32_t BGRA = FourCC('B', 'G', 'R', 'A');
constexpr uint32_t BGRX = FourCC('B', 'G', 'R', 'X');
constexpr int progressive = 1;
constexpr int64_t timecode_synthesize = INT64_MAX;

typedef bool (*initialize_fn)(void);
typedef const char* (*version_fn)(void);
typedef send_instance_t (*send_create_fn)(const send_create_t*);
typedef void (*send_destroy_fn)(send_instance_t);
typedef void (*send_video_fn)(send_instance_t, const video_frame_v2_t*);
typedef int (*send_get_no_connections_fn)(send_instance_t, uint32_t);
typedef bool (*send_get_tally_fn)(send_instance_t, tally_t*, uint32_t);

struct Lib {
  LibHandle handle = nullptr;
  std::string path, error, version;
  initialize_fn initialize = nullptr;
  version_fn get_version = nullptr;
  send_create_fn send_create = nullptr;
  send_destroy_fn send_destroy = nullptr;
  send_video_fn send_video = nullptr;
  send_get_no_connections_fn get_connections = nullptr;
  send_get_tally_fn get_tally = nullptr;
  bool ready = false;
};
}  // namespace ndi

static ndi::Lib g_lib;
static std::mutex g_libMtx;
static std::string g_userPath;              // vom Benutzer gewählte Bibliothek (Vorrang)
static std::vector<std::string> g_searched; // für die Fehleranzeige

#if defined(__APPLE__)
/* NDI Tools for Mac bringen die Bibliothek in ihren Programmen mit (z. B. NDI Video Monitor.app/Contents/Frameworks) */
static void ScanAppBundles(const std::string& dir, int depth, std::vector<std::string>& out) {
  DIR* dp = opendir(dir.c_str());
  if (!dp) return;
  std::vector<std::string> subdirs;
  while (dirent* e = readdir(dp)) {
    std::string n = e->d_name;
    if (n == "." || n == "..") continue;
    std::string lower = n; for (auto& ch : lower) ch = (char)tolower((unsigned char)ch);
    const std::string full = dir + "/" + n;
    if (lower.size() > 4 && lower.compare(lower.size() - 4, 4, ".app") == 0) {
      if (lower.find("ndi") == std::string::npos) continue;
      for (const char* sub : { "/Contents/Frameworks", "/Contents/Resources", "/Contents/MacOS", "/Contents/Libraries" }) {
        const std::string fdir = full + sub;
        if (DIR* fd = opendir(fdir.c_str())) {
          while (dirent* f = readdir(fd)) {
            std::string fn = f->d_name;
            if (fn.rfind("libndi", 0) == 0 && fn.size() > 6 && fn.find(".dylib") != std::string::npos) out.push_back(fdir + "/" + fn);
          }
          closedir(fd);
        }
      }
    } else if (depth > 0 && lower.find("ndi") != std::string::npos) {
      subdirs.push_back(full);  // z. B. /Applications/NDI Tools/
    }
  }
  closedir(dp);
  for (const auto& d : subdirs) ScanAppBundles(d, depth - 1, out);
}
#endif

static std::vector<std::string> Candidates() {
  std::vector<std::string> out;
  auto env = [](const char* n) -> std::string { const char* v = getenv(n); return v ? std::string(v) : std::string(); };
  if (!g_userPath.empty()) out.push_back(g_userPath);
  const std::string custom = env("CUEGFX_NDI_LIB");
  if (!custom.empty()) out.push_back(custom);
#if defined(_WIN32)
  const char* name = "Processing.NDI.Lib.x64.dll";
  for (const char* var : { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5" }) {
    std::string d = env(var);
    if (!d.empty()) out.push_back(d + "\\" + name);
  }
  out.push_back("C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\" + std::string(name));
  out.push_back("C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime\\" + std::string(name));
  out.push_back("C:\\Program Files\\NDI\\NDI 5 Runtime\\v5\\" + std::string(name));
  out.push_back(name);  // Suchpfad
#elif defined(__APPLE__)
  for (const char* var : { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5" }) {
    std::string d = env(var);
    if (!d.empty()) out.push_back(d + "/libndi.dylib");
  }
  out.push_back("/usr/local/lib/libndi.dylib");
  out.push_back("/opt/homebrew/lib/libndi.dylib");
  out.push_back("/usr/local/lib/libndi_advanced.dylib");
  out.push_back("/Library/NDI SDK for Apple/lib/macOS/libndi.dylib");
  out.push_back("/Library/NDI Advanced SDK for Apple/lib/macOS/libndi_advanced.dylib");
  out.push_back("/Library/Application Support/NDI/libndi.dylib");
  // Bibliotheken aus den installierten NDI-Programmen (NDI Tools); libndi.dylib vor libndi_advanced.dylib
  std::vector<std::string> bundled;
  ScanAppBundles("/Applications", 2, bundled);
  const std::string home = env("HOME");
  if (!home.empty()) ScanAppBundles(home + "/Applications", 2, bundled);
  std::stable_sort(bundled.begin(), bundled.end(), [](const std::string& a, const std::string& b) {
    auto rank = [](const std::string& p) { return p.find("/libndi.dylib") != std::string::npos ? 0 : p.find("advanced") != std::string::npos ? 2 : 1; };
    return rank(a) < rank(b);
  });
  for (const auto& b : bundled) out.push_back(b);
#else
  std::vector<std::string> dirs;
  for (const char* var : { "NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5" }) { std::string d = env(var); if (!d.empty()) dirs.push_back(d); }
  for (const char* d : { "/usr/lib", "/usr/lib64", "/usr/local/lib", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/opt/ndi/lib" }) dirs.push_back(d);
  for (const auto& d : dirs) {
    // höchste Hauptversion bevorzugen (libndi.so.6 vor libndi.so.5)
    int best = -1; std::string bestName;
    if (DIR* dp = opendir(d.c_str())) {
      while (dirent* e = readdir(dp)) {
        std::string n = e->d_name;
        if (n.rfind("libndi.so.", 0) == 0) {
          int v = atoi(n.c_str() + 10);
          if (v > best) { best = v; bestName = n; }
        }
      }
      closedir(dp);
    }
    if (best >= 0) out.push_back(d + "/" + bestName);
  }
  out.push_back("libndi.so.6");
  out.push_back("libndi.so.5");
#endif
  return out;
}

static bool LoadLib() {
  std::lock_guard<std::mutex> l(g_libMtx);
  if (g_lib.ready) return true;
  g_lib.error.clear();
  g_searched.clear();
  std::string loadErrors;
  for (const auto& p : Candidates()) {
    const bool absolute = p.find('/') != std::string::npos || p.find('\\') != std::string::npos;
    g_searched.push_back(p);
    if (absolute && !FileExists(p)) continue;
    LibHandle h = LibOpen(p);
    if (!h) { if (absolute) loadErrors += "\n• " + p + ": " + LibError(); continue; }
    ndi::Lib L;
    L.handle = h; L.path = p;
    L.initialize = (ndi::initialize_fn)LibSym(h, "NDIlib_initialize");
    L.get_version = (ndi::version_fn)LibSym(h, "NDIlib_version");
    L.send_create = (ndi::send_create_fn)LibSym(h, "NDIlib_send_create");
    L.send_destroy = (ndi::send_destroy_fn)LibSym(h, "NDIlib_send_destroy");
    L.send_video = (ndi::send_video_fn)LibSym(h, "NDIlib_send_send_video_v2");
    L.get_connections = (ndi::send_get_no_connections_fn)LibSym(h, "NDIlib_send_get_no_connections");
    L.get_tally = (ndi::send_get_tally_fn)LibSym(h, "NDIlib_send_get_tally");
    if (!L.initialize || !L.send_create || !L.send_destroy || !L.send_video) { g_lib.error = "Bibliothek ist keine gültige NDI-Laufzeit: " + p; continue; }
    if (!L.initialize()) { g_lib.error = "NDI konnte nicht initialisiert werden (Prozessor nicht unterstützt?)"; continue; }
    if (L.get_version) { const char* v = L.get_version(); if (v) L.version = v; }
    L.ready = true;
    g_lib = L;
    return true;
  }
  if (!loadErrors.empty()) g_lib.error = "NDI-Bibliothek gefunden, aber nicht ladbar:" + loadErrors;
  else if (g_lib.error.empty()) g_lib.error = "NDI-Laufzeit nicht gefunden. Bitte die NDI Runtime bzw. „NDI Tools“ installieren (https://ndi.video/tools/) oder den Pfad zu libndi manuell angeben.";
  return false;
}

/* ---------- Sender ---------- */
struct SenderConfig {
  std::string name, groups;
  int width = 1920, height = 1080;
  int fpsN = 50, fpsD = 1;
  bool alpha = true;
};

static inline uint8_t Clamp8(int v) { return (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v); }

class Sender {
 public:
  explicit Sender(const SenderConfig& c) : cfg_(c) {}
  ~Sender() { Stop(); }

  bool Start(std::string* err) {
    if (!LoadLib()) { *err = g_lib.error; return false; }
    ndi::send_create_t cr;
    cr.p_ndi_name = cfg_.name.c_str();
    cr.p_groups = cfg_.groups.empty() ? nullptr : cfg_.groups.c_str();
    cr.clock_video = true;  // NDI taktet die Ausgabe selbst auf die Bildrate
    cr.clock_audio = false;
    inst_ = g_lib.send_create(&cr);
    if (!inst_) { *err = "NDI-Sender konnte nicht erstellt werden (Name bereits vergeben?)"; return false; }
    const size_t bytes = (size_t)cfg_.width * cfg_.height * 4;
    pending_.assign(bytes, 0);
    send_.assign(bytes, 0);
    if (!cfg_.alpha) for (size_t i = 3; i < bytes; i += 4) { pending_[i] = 255; send_[i] = 255; }
    running_ = true;
    thread_ = std::thread([this] { Loop(); });
    return true;
  }

  void Stop() {
    if (running_.exchange(false) && thread_.joinable()) thread_.join();
    if (inst_) { g_lib.send_destroy(inst_); inst_ = nullptr; }
  }

  /* Grafik-Bild übernehmen: BGRA vormultipliert (wie von Chromium geliefert), beliebige Größe */
  void Push(const uint8_t* src, int w, int h) {
    if (!running_) return;
    std::lock_guard<std::mutex> l(mtx_);
    const int W = cfg_.width, H = cfg_.height;
    if (w == W && h == H) memcpy(pending_.data(), src, (size_t)W * H * 4);
    else {
      for (int y = 0; y < H; ++y) {
        const uint32_t* row = (const uint32_t*)(src + (size_t)((int64_t)y * h / H) * w * 4);
        uint32_t* out = (uint32_t*)(pending_.data() + (size_t)y * W * 4);
        for (int x = 0; x < W; ++x) out[x] = row[(int64_t)x * w / W];
      }
    }
    dirty_ = true;
    pushed_++;
  }

  int Connections() { return (inst_ && g_lib.get_connections) ? g_lib.get_connections(inst_, 0) : 0; }
  bool Tally(bool* program, bool* preview) {
    if (!inst_ || !g_lib.get_tally) return false;
    ndi::tally_t t{ false, false };
    g_lib.get_tally(inst_, &t, 0);
    *program = t.on_program; *preview = t.on_preview;
    return true;
  }
  uint64_t Sent() const { return sent_.load(); }
  uint64_t Pushed() const { return pushed_.load(); }
  bool Running() const { return running_.load(); }
  const SenderConfig& Config() const { return cfg_; }

 private:
  void Loop() {
    ndi::video_frame_v2_t f;
    memset(&f, 0, sizeof(f));
    f.xres = cfg_.width; f.yres = cfg_.height;
    f.FourCC = cfg_.alpha ? ndi::BGRA : ndi::BGRX;
    f.frame_rate_N = cfg_.fpsN; f.frame_rate_D = cfg_.fpsD;
    f.picture_aspect_ratio = (float)cfg_.width / (float)cfg_.height;
    f.frame_format_type = ndi::progressive;
    f.timecode = ndi::timecode_synthesize;
    f.line_stride_in_bytes = cfg_.width * 4;
    f.p_metadata = nullptr;
    f.timestamp = 0;
    const size_t px = (size_t)cfg_.width * cfg_.height;
    while (running_) {
      {
        std::lock_guard<std::mutex> l(mtx_);
        if (dirty_) { send_.swap(pending_); dirty_ = false; fresh_ = true; }
      }
      if (fresh_) {
        fresh_ = false;
        uint8_t* p = send_.data();
        if (cfg_.alpha) {
          // NDI erwartet gerades (nicht vormultipliertes) Alpha
          for (size_t i = 0; i < px; ++i) {
            uint8_t* q = p + i * 4;
            const int a = q[3];
            if (a == 255) continue;
            if (a == 0) { q[0] = q[1] = q[2] = 0; continue; }
            q[0] = Clamp8((q[0] * 255 + a / 2) / a);
            q[1] = Clamp8((q[1] * 255 + a / 2) / a);
            q[2] = Clamp8((q[2] * 255 + a / 2) / a);
          }
        } else {
          for (size_t i = 0; i < px; ++i) p[i * 4 + 3] = 255;
        }
      }
      f.p_data = send_.data();
      g_lib.send_video(inst_, &f);  // blockiert passend zur Bildrate (clock_video)
      sent_++;
    }
  }

  SenderConfig cfg_;
  ndi::send_instance_t inst_ = nullptr;
  std::thread thread_;
  std::mutex mtx_;
  std::vector<uint8_t> pending_, send_;
  bool dirty_ = false, fresh_ = false;
  std::atomic<bool> running_{false};
  std::atomic<uint64_t> sent_{0}, pushed_{0};
};

/* ---------- Node-API ---------- */
static napi_value Str(napi_env env, const std::string& s) { napi_value v; napi_create_string_utf8(env, s.c_str(), s.size(), &v); return v; }
static napi_value Num(napi_env env, double d) { napi_value v; napi_create_double(env, d, &v); return v; }
static napi_value Bool(napi_env env, bool b) { napi_value v; napi_get_boolean(env, b, &v); return v; }
static void Set(napi_env env, napi_value o, const char* k, napi_value v) { napi_set_named_property(env, o, k, v); }
static bool Prop(napi_env env, napi_value o, const char* k, napi_value* out) {
  bool has = false;
  if (napi_has_named_property(env, o, k, &has) != napi_ok || !has) return false;
  napi_get_named_property(env, o, k, out);
  napi_valuetype t; napi_typeof(env, *out, &t);
  return t != napi_undefined && t != napi_null;
}
static double GetNum(napi_env env, napi_value o, const char* k, double d) { napi_value v; double r; return Prop(env, o, k, &v) && napi_get_value_double(env, v, &r) == napi_ok ? r : d; }
static bool GetBool(napi_env env, napi_value o, const char* k, bool d) { napi_value v; bool r; return Prop(env, o, k, &v) && napi_get_value_bool(env, v, &r) == napi_ok ? r : d; }
static std::string GetStr(napi_env env, napi_value o, const char* k, const std::string& d) {
  napi_value v; if (!Prop(env, o, k, &v)) return d;
  size_t n = 0; if (napi_get_value_string_utf8(env, v, nullptr, 0, &n) != napi_ok) return d;
  std::string s(n, '\0'); napi_get_value_string_utf8(env, v, &s[0], n + 1, &n); return s;
}
static Sender* GetSender(napi_env env, napi_value v) { void* p = nullptr; return napi_get_value_external(env, v, &p) == napi_ok ? (Sender*)p : nullptr; }

static napi_value InfoJs(napi_env env, napi_callback_info) {
  const bool ok = LoadLib();
  napi_value o; napi_create_object(env, &o);
  Set(env, o, "available", Bool(env, ok));
  Set(env, o, "version", Str(env, g_lib.version));
  Set(env, o, "path", Str(env, g_lib.path));
  Set(env, o, "error", Str(env, ok ? "" : g_lib.error));
  napi_value arr; napi_create_array_with_length(env, g_searched.size(), &arr);
  for (size_t i = 0; i < g_searched.size(); ++i) napi_set_element(env, arr, (uint32_t)i, Str(env, g_searched[i]));
  Set(env, o, "searched", arr);
  return o;
}

/* setLibrary(path) – eigenen Pfad zur NDI-Bibliothek setzen (wirkt, solange noch keine geladen ist) */
static napi_value SetLibraryJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string p;
  if (argc >= 1) {
    napi_valuetype t; napi_typeof(env, argv[0], &t);
    if (t == napi_string) { size_t n = 0; napi_get_value_string_utf8(env, argv[0], nullptr, 0, &n); p.assign(n, '\0'); napi_get_value_string_utf8(env, argv[0], &p[0], n + 1, &n); }
  }
  { std::lock_guard<std::mutex> l(g_libMtx); g_userPath = p; }
  return Bool(env, g_lib.ready);
}

static napi_value CreateJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) { napi_throw_type_error(env, nullptr, "Konfiguration fehlt"); return nullptr; }
  SenderConfig c;
  c.name = GetStr(env, argv[0], "name", "CueGFX");
  c.groups = GetStr(env, argv[0], "groups", "");
  c.width = (int)GetNum(env, argv[0], "width", 1920);
  c.height = (int)GetNum(env, argv[0], "height", 1080);
  c.fpsN = (int)GetNum(env, argv[0], "fpsN", 50);
  c.fpsD = (int)GetNum(env, argv[0], "fpsD", 1);
  c.alpha = GetBool(env, argv[0], "alpha", true);
  if (c.width < 16 || c.height < 16 || c.width > 7680 || c.height > 4320 || c.fpsN <= 0 || c.fpsD <= 0) { napi_throw_range_error(env, nullptr, "Ungültige Auflösung oder Bildrate"); return nullptr; }
  Sender* s = new Sender(c);
  std::string err;
  if (!s->Start(&err)) { delete s; napi_throw_error(env, nullptr, err.c_str()); return nullptr; }
  napi_value ext;
  napi_create_external(env, s, [](napi_env, void* d, void*) { Sender* x = (Sender*)d; x->Stop(); delete x; }, nullptr, &ext);
  return ext;
}

static napi_value PushJs(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 4) { napi_throw_type_error(env, nullptr, "push(handle, buffer, width, height)"); return nullptr; }
  Sender* s = GetSender(env, argv[0]);
  if (!s) return nullptr;
  void* data = nullptr; size_t len = 0; bool isBuf = false;
  napi_is_buffer(env, argv[1], &isBuf);
  if (isBuf) napi_get_buffer_info(env, argv[1], &data, &len);
  else { napi_throw_type_error(env, nullptr, "Buffer erwartet"); return nullptr; }
  int32_t w = 0, h = 0;
  napi_get_value_int32(env, argv[2], &w); napi_get_value_int32(env, argv[3], &h);
  if (w <= 0 || h <= 0 || len < (size_t)w * h * 4) { napi_throw_range_error(env, nullptr, "Puffer passt nicht zur Größe"); return nullptr; }
  s->Push((const uint8_t*)data, w, h);
  return nullptr;
}

static napi_value StatusJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  Sender* s = argc ? GetSender(env, argv[0]) : nullptr;
  if (!s) return nullptr;
  napi_value o; napi_create_object(env, &o);
  bool prog = false, prev = false;
  s->Tally(&prog, &prev);
  Set(env, o, "running", Bool(env, s->Running()));
  Set(env, o, "connections", Num(env, s->Connections()));
  Set(env, o, "sent", Num(env, (double)s->Sent()));
  Set(env, o, "pushed", Num(env, (double)s->Pushed()));
  Set(env, o, "tallyProgram", Bool(env, prog));
  Set(env, o, "tallyPreview", Bool(env, prev));
  Set(env, o, "width", Num(env, s->Config().width));
  Set(env, o, "height", Num(env, s->Config().height));
  Set(env, o, "fps", Num(env, (double)s->Config().fpsN / s->Config().fpsD));
  return o;
}

static napi_value StopJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  Sender* s = argc ? GetSender(env, argv[0]) : nullptr;
  if (s) s->Stop();
  return nullptr;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "info", nullptr, InfoJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "setLibrary", nullptr, SetLibraryJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "create", nullptr, CreateJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "push", nullptr, PushJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "status", nullptr, StatusJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "stop", nullptr, StopJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
