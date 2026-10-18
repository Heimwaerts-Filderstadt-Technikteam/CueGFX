// CueGFX DeckLink – Plattform-Abstraktion für macOS, Windows und Linux
#pragma once

#include <string>
#include <cstdint>
#include <cstdlib>
#include <cstring>

#if defined(_WIN32)
  #ifndef NOMINMAX
    #define NOMINMAX
  #endif
  #include <windows.h>
  #include <objbase.h>
  #include <oleauto.h>
  #include "DeckLinkAPI_h.h"      // per MIDL aus DeckLinkAPI.idl erzeugt (scripts/build-decklink.js)
  #include "DeckLinkAPIVersion.h"
  typedef BSTR DLString;
  typedef BOOL DLBool;
  typedef LONGLONG DLInt64;
#elif defined(__APPLE__)
  #include "DeckLinkAPI.h"
  #include "DeckLinkAPIVersion.h"
  typedef CFStringRef DLString;
  typedef bool DLBool;
  typedef int64_t DLInt64;
#else
  #include "DeckLinkAPI.h"
  #include "DeckLinkAPIVersion.h"
  typedef const char* DLString;
  typedef bool DLBool;
  typedef int64_t DLInt64;
#endif

#ifndef STDMETHODCALLTYPE
  #define STDMETHODCALLTYPE
#endif

// Ab Desktop Video SDK 14.3 liefern Frames ihre Pixel nur noch über IDeckLinkVideoBuffer
#if defined(BLACKMAGIC_DECKLINK_API_VERSION) && (BLACKMAGIC_DECKLINK_API_VERSION >= 0x0e030000)
  #define CUE_DL_VIDEOBUFFER 1
#endif

inline std::string DLToStd(DLString s) {
  if (!s) return std::string();
#if defined(_WIN32)
  int len = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
  if (len <= 1) return std::string();
  std::string out((size_t)len - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s, -1, &out[0], len, nullptr, nullptr);
  return out;
#elif defined(__APPLE__)
  CFIndex max = CFStringGetMaximumSizeForEncoding(CFStringGetLength(s), kCFStringEncodingUTF8) + 1;
  std::string out((size_t)max, '\0');
  if (!CFStringGetCString(s, &out[0], max, kCFStringEncodingUTF8)) return std::string();
  out.resize(strlen(out.c_str()));
  return out;
#else
  return std::string(s);
#endif
}

inline void DLFree(DLString s) {
  if (!s) return;
#if defined(_WIN32)
  SysFreeString(s);
#elif defined(__APPLE__)
  CFRelease(s);
#else
  free((void*)s);
#endif
}

inline void DLComInit() {
#if defined(_WIN32)
  // Electron initialisiert den Hauptthread bereits als STA – RPC_E_CHANGED_MODE ist dann in Ordnung
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  (void)hr;
#endif
}

inline IDeckLinkIterator* DLCreateIterator() {
  DLComInit();
#if defined(_WIN32)
  IDeckLinkIterator* it = nullptr;
  if (FAILED(CoCreateInstance(CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL, IID_IDeckLinkIterator, (void**)&it))) return nullptr;
  return it;
#else
  return CreateDeckLinkIteratorInstance();
#endif
}

inline IDeckLinkAPIInformation* DLCreateApiInfo() {
  DLComInit();
#if defined(_WIN32)
  IDeckLinkAPIInformation* info = nullptr;
  if (FAILED(CoCreateInstance(CLSID_CDeckLinkAPIInformation, nullptr, CLSCTX_ALL, IID_IDeckLinkAPIInformation, (void**)&info))) return nullptr;
  return info;
#else
  return CreateDeckLinkAPIInformationInstance();
#endif
}

/* IID-Vergleich für QueryInterface der eigenen Callback-Objekte (der Treiber fragt IUnknown bzw. das Callback-Interface ab) */
inline bool DLSameIID(REFIID a, REFIID b) {
#if defined(_WIN32)
  return IsEqualIID(a, b) ? true : false;
#else
  return memcmp(&a, &b, sizeof(REFIID)) == 0;
#endif
}
inline bool DLIsIUnknown(REFIID iid) {
#if defined(_WIN32)
  return IsEqualIID(iid, IID_IUnknown) ? true : false;
#else
  // 00000000-0000-0000-C000-000000000046
  static const uint8_t k[16] = { 0, 0, 0, 0, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46 };
  return memcmp(&iid, k, 16) == 0;
#endif
}

inline std::string FourCC(uint32_t v) {
  std::string s;
  for (int i = 3; i >= 0; --i) {
    char c = (char)((v >> (i * 8)) & 0xff);
    s += (c >= 32 && c < 127) ? c : '?';
  }
  return s;
}

inline uint32_t FromFourCC(const std::string& s) {
  if (s.size() != 4) return 0;
  return ((uint32_t)(uint8_t)s[0] << 24) | ((uint32_t)(uint8_t)s[1] << 16) | ((uint32_t)(uint8_t)s[2] << 8) | (uint32_t)(uint8_t)s[3];
}

/* Zugriff auf Frame-Pixel – kompatibel mit SDK < 14.3 (GetBytes) und >= 14.3 (IDeckLinkVideoBuffer) */
struct FrameAccess {
  void* bytes = nullptr;
  bool write = false;
#ifdef CUE_DL_VIDEOBUFFER
  IDeckLinkVideoBuffer* buffer = nullptr;
#endif
  FrameAccess(IDeckLinkVideoFrame* frame, bool forWrite) : write(forWrite) {
    if (!frame) return;
#ifdef CUE_DL_VIDEOBUFFER
    if (frame->QueryInterface(IID_IDeckLinkVideoBuffer, (void**)&buffer) != S_OK || !buffer) { buffer = nullptr; return; }
    if (buffer->StartAccess(forWrite ? bmdBufferAccessWrite : bmdBufferAccessRead) != S_OK) { buffer->Release(); buffer = nullptr; return; }
    if (buffer->GetBytes(&bytes) != S_OK) bytes = nullptr;
#else
    if (frame->GetBytes(&bytes) != S_OK) bytes = nullptr;
#endif
  }
  ~FrameAccess() {
#ifdef CUE_DL_VIDEOBUFFER
    if (buffer) {
      buffer->EndAccess(write ? bmdBufferAccessWrite : bmdBufferAccessRead);
      buffer->Release();
    }
#endif
  }
  FrameAccess(const FrameAccess&) = delete;
  FrameAccess& operator=(const FrameAccess&) = delete;
};
