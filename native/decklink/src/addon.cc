// CueGFX DeckLink – Node-API-Anbindung (ABI-stabil, läuft in Node.js und Electron)
#include <node_api.h>
#include "dl_engine.h"
#include <string>

using namespace cuedl;

#define NAPI_CALL(env, call)                                         \
  do {                                                               \
    if ((call) != napi_ok) {                                         \
      napi_throw_error((env), nullptr, "Node-API-Aufruf fehlgeschlagen: " #call); \
      return nullptr;                                                \
    }                                                                \
  } while (0)

static napi_value Str(napi_env env, const std::string& s) { napi_value v; napi_create_string_utf8(env, s.c_str(), s.size(), &v); return v; }
static napi_value Num(napi_env env, double d) { napi_value v; napi_create_double(env, d, &v); return v; }
static napi_value Bool(napi_env env, bool b) { napi_value v; napi_get_boolean(env, b, &v); return v; }
static void Set(napi_env env, napi_value o, const char* k, napi_value v) { napi_set_named_property(env, o, k, v); }

static bool GetProp(napi_env env, napi_value obj, const char* key, napi_value* out) {
  bool has = false;
  if (napi_has_named_property(env, obj, key, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, obj, key, out) != napi_ok) return false;
  napi_valuetype t; napi_typeof(env, *out, &t);
  return t != napi_undefined && t != napi_null;
}
static double GetNum(napi_env env, napi_value obj, const char* key, double def) {
  napi_value v; if (!GetProp(env, obj, key, &v)) return def;
  double d; if (napi_get_value_double(env, v, &d) != napi_ok) return def; return d;
}
static bool GetBool(napi_env env, napi_value obj, const char* key, bool def) {
  napi_value v; if (!GetProp(env, obj, key, &v)) return def;
  bool b; if (napi_get_value_bool(env, v, &b) != napi_ok) return def; return b;
}
static std::string GetStr(napi_env env, napi_value obj, const char* key, const std::string& def) {
  napi_value v; if (!GetProp(env, obj, key, &v)) return def;
  size_t len = 0; if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) return def;
  std::string s(len, '\0'); napi_get_value_string_utf8(env, v, &s[0], len + 1, &len); return s;
}

static napi_value ModesToJs(napi_env env, const std::vector<ModeInfo>& modes) {
  napi_value arr; napi_create_array_with_length(env, modes.size(), &arr);
  for (size_t i = 0; i < modes.size(); ++i) {
    const ModeInfo& m = modes[i];
    napi_value o; napi_create_object(env, &o);
    Set(env, o, "id", Str(env, m.id));
    Set(env, o, "code", Num(env, (double)m.code));
    Set(env, o, "name", Str(env, m.name));
    Set(env, o, "width", Num(env, m.width));
    Set(env, o, "height", Num(env, m.height));
    Set(env, o, "fps", Num(env, m.fps));
    Set(env, o, "interlaced", Bool(env, m.interlaced));
    napi_set_element(env, arr, (uint32_t)i, o);
  }
  return arr;
}

/* listDevices() -> { devices: [...], error } */
static napi_value ListDevicesJs(napi_env env, napi_callback_info) {
  std::string err;
  std::vector<DeviceInfo> devs = ListDevices(&err);
  napi_value res; napi_create_object(env, &res);
  napi_value arr; napi_create_array_with_length(env, devs.size(), &arr);
  for (size_t i = 0; i < devs.size(); ++i) {
    const DeviceInfo& d = devs[i];
    napi_value o; napi_create_object(env, &o);
    Set(env, o, "index", Num(env, d.index));
    Set(env, o, "key", Str(env, d.key));
    Set(env, o, "name", Str(env, d.name));
    Set(env, o, "model", Str(env, d.model));
    Set(env, o, "canOutput", Bool(env, d.canOutput));
    Set(env, o, "canInput", Bool(env, d.canInput));
    Set(env, o, "externalKeying", Bool(env, d.externalKeying));
    Set(env, o, "internalKeying", Bool(env, d.internalKeying));
    Set(env, o, "formatDetection", Bool(env, d.formatDetection));
    Set(env, o, "outputModes", ModesToJs(env, d.outputModes));
    Set(env, o, "inputModes", ModesToJs(env, d.inputModes));
    napi_set_element(env, arr, (uint32_t)i, o);
  }
  Set(env, res, "devices", arr);
  if (!err.empty()) Set(env, res, "error", Str(env, err));
  return res;
}

static napi_value VersionJs(napi_env env, napi_callback_info) {
  napi_value o; napi_create_object(env, &o);
  Set(env, o, "sdk", Str(env, BLACKMAGIC_DECKLINK_API_VERSION_STRING));
  Set(env, o, "driver", Str(env, DriverVersion()));
  return o;
}

/* ---------- Ausgabe-Objekte als External ---------- */
static void FinalizeOutput(napi_env, void* data, void*) {
  OutputEngine* e = static_cast<OutputEngine*>(data);
  if (e) { e->Stop(); delete e; }
}

static OutputEngine* GetEngine(napi_env env, napi_value v) {
  void* p = nullptr;
  if (napi_get_value_external(env, v, &p) != napi_ok) return nullptr;
  return static_cast<OutputEngine*>(p);
}

/* createOutput({deviceIndex, mode, keying, keyLevel, inputDeviceIndex, inputMode, pixelFormat, straightAlpha, swapRB, preroll}) */
static napi_value CreateOutputJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (argc < 1) { napi_throw_type_error(env, nullptr, "Konfiguration fehlt"); return nullptr; }
  OutputConfig c;
  c.deviceIndex = (int)GetNum(env, argv[0], "deviceIndex", -1);
  const std::string mode = GetStr(env, argv[0], "mode", "Hp50");
  c.modeCode = FromFourCC(mode);
  const std::string keying = GetStr(env, argv[0], "keying", "none");
  c.keying = keying == "external" ? KeyExternal : keying == "internal" ? KeyInternal : keying == "software" ? KeySoftware : KeyNone;
  c.keyLevel = (int)GetNum(env, argv[0], "keyLevel", 255);
  c.inputDeviceIndex = (int)GetNum(env, argv[0], "inputDeviceIndex", -1);
  const std::string inMode = GetStr(env, argv[0], "inputMode", "");
  c.inputModeCode = inMode.size() == 4 ? FromFourCC(inMode) : 0;
  const std::string pf = GetStr(env, argv[0], "pixelFormat", "auto");
  c.pixelFormat = pf == "argb" ? PixARGB : pf == "yuv" ? PixYUV : pf == "bgra" ? PixBGRA : PixAuto;
  c.straightAlpha = GetBool(env, argv[0], "straightAlpha", false);
  c.swapRB = GetBool(env, argv[0], "swapRB", false);
  c.preroll = (int)GetNum(env, argv[0], "preroll", 3);
  c.syncMode = GetStr(env, argv[0], "outputMode", "auto") == "sync";
  if (!c.modeCode) { napi_throw_error(env, nullptr, "Ungültiges Videoformat"); return nullptr; }
  OutputEngine* e = new OutputEngine(c);
  napi_value ext;
  if (napi_create_external(env, e, FinalizeOutput, nullptr, &ext) != napi_ok) { delete e; napi_throw_error(env, nullptr, "External konnte nicht erzeugt werden"); return nullptr; }
  return ext;
}

static napi_value StartJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  OutputEngine* e = argc ? GetEngine(env, argv[0]) : nullptr;
  if (!e) { napi_throw_type_error(env, nullptr, "Ungültiges Ausgabe-Objekt"); return nullptr; }
  if (!e->Start()) { napi_throw_error(env, nullptr, e->Status().error.c_str()); return nullptr; }
  napi_value o; napi_create_object(env, &o);
  Set(env, o, "width", Num(env, e->Width()));
  Set(env, o, "height", Num(env, e->Height()));
  return o;
}

/* push(handle, buffer, width, height) – BGRA, vormultipliert */
static napi_value PushJs(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (argc < 4) { napi_throw_type_error(env, nullptr, "push(handle, buffer, width, height)"); return nullptr; }
  OutputEngine* e = GetEngine(env, argv[0]);
  if (!e) return nullptr;
  void* data = nullptr; size_t len = 0;
  bool isBuf = false;
  napi_is_buffer(env, argv[1], &isBuf);
  if (isBuf) napi_get_buffer_info(env, argv[1], &data, &len);
  else {
    bool isTa = false; napi_is_typedarray(env, argv[1], &isTa);
    if (!isTa) { napi_throw_type_error(env, nullptr, "Buffer erwartet"); return nullptr; }
    napi_typedarray_type t; size_t n; napi_value ab; size_t off;
    napi_get_typedarray_info(env, argv[1], &t, &n, &data, &ab, &off);
    len = n;
  }
  int32_t w = 0, h = 0;
  napi_get_value_int32(env, argv[2], &w);
  napi_get_value_int32(env, argv[3], &h);
  if (w <= 0 || h <= 0 || len < (size_t)w * h * 4) { napi_throw_range_error(env, nullptr, "Puffer passt nicht zur Größe"); return nullptr; }
  e->PushFrame(static_cast<const uint8_t*>(data), w, h);
  return nullptr;
}

static napi_value StatusJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  OutputEngine* e = argc ? GetEngine(env, argv[0]) : nullptr;
  if (!e) return nullptr;
  OutputStatus s = e->Status();
  napi_value o; napi_create_object(env, &o);
  Set(env, o, "running", Bool(env, s.running));
  Set(env, o, "error", Str(env, s.error));
  Set(env, o, "mode", Str(env, s.modeName));
  Set(env, o, "width", Num(env, s.width));
  Set(env, o, "height", Num(env, s.height));
  Set(env, o, "fps", Num(env, s.fps));
  Set(env, o, "completed", Num(env, (double)s.completed));
  Set(env, o, "late", Num(env, (double)s.late));
  Set(env, o, "dropped", Num(env, (double)s.dropped));
  Set(env, o, "flushed", Num(env, (double)s.flushed));
  Set(env, o, "pushed", Num(env, (double)s.pushed));
  Set(env, o, "inputSignal", Bool(env, s.inputSignal));
  Set(env, o, "inputMode", Str(env, s.inputMode));
  Set(env, o, "outputMode", Str(env, s.outputMode));
  Set(env, o, "pixelFormat", Str(env, s.pixelFormat));
  return o;
}

static napi_value StopJs(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  OutputEngine* e = argc ? GetEngine(env, argv[0]) : nullptr;
  if (e) e->Stop();
  return nullptr;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "listDevices", nullptr, ListDevicesJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "version", nullptr, VersionJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "createOutput", nullptr, CreateOutputJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "start", nullptr, StartJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "push", nullptr, PushJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "status", nullptr, StatusJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
    { "stop", nullptr, StopJs, nullptr, nullptr, nullptr, napi_enumerable, nullptr },
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
