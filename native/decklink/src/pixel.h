// CueGFX DeckLink – Pixel-Konvertierungen (ohne SDK-Abhängigkeit, separat testbar)
#pragma once
#include <cstdint>
#include <cstring>
#include <algorithm>

namespace cuepx {

static inline uint8_t clamp8(int v) { return (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v); }

/* UYVY (8-Bit 4:2:2, Videopegel) -> BGRA mit Nearest-Neighbour-Skalierung auf die Zielgröße.
   hd = true: BT.709, sonst BT.601 */
inline void UyvyToBgraScaled(const uint8_t* src, int sw, int sh, int srcRowBytes, uint8_t* dst, int dw, int dh, bool hd) {
  // Festkomma-Koeffizienten * 1024
  const int cy = 1192;
  const int crR = hd ? 1836 : 1634, cbG = hd ? 218 : 401, crG = hd ? 546 : 833, cbB = hd ? 2163 : 2066;
  for (int y = 0; y < dh; ++y) {
    const int syy = (int)((int64_t)y * sh / dh);
    const uint8_t* row = src + (size_t)syy * srcRowBytes;
    uint8_t* out = dst + (size_t)y * dw * 4;
    for (int x = 0; x < dw; ++x) {
      const int sx = (int)((int64_t)x * sw / dw);
      const uint8_t* pair = row + (sx & ~1) * 2;
      const int cb = pair[0] - 128, cr = pair[2] - 128;
      const int yy = (pair[(sx & 1) ? 3 : 1] - 16) * cy;
      out[x * 4 + 0] = clamp8((yy + cbB * cb + 512) >> 10);
      out[x * 4 + 1] = clamp8((yy - cbG * cb - crG * cr + 512) >> 10);
      out[x * 4 + 2] = clamp8((yy + crR * cr + 512) >> 10);
      out[x * 4 + 3] = 255;
    }
  }
}

/* ARGB (8-Bit, Byte-Reihenfolge A R G B) -> BGRA mit Skalierung */
inline void ArgbToBgraScaled(const uint8_t* src, int sw, int sh, int srcRowBytes, uint8_t* dst, int dw, int dh) {
  for (int y = 0; y < dh; ++y) {
    const uint8_t* row = src + (size_t)((int64_t)y * sh / dh) * srcRowBytes;
    uint8_t* out = dst + (size_t)y * dw * 4;
    for (int x = 0; x < dw; ++x) {
      const uint8_t* p = row + (size_t)((int64_t)x * sw / dw) * 4;
      out[x * 4 + 0] = p[3]; out[x * 4 + 1] = p[2]; out[x * 4 + 2] = p[1]; out[x * 4 + 3] = 255;
    }
  }
}

/* BGRA mit Skalierung (Nearest) – für Grafik-Frames, die nicht exakt der Ausgabegröße entsprechen */
inline void BgraScaled(const uint8_t* src, int sw, int sh, uint8_t* dst, int dw, int dh) {
  if (sw == dw && sh == dh) { memcpy(dst, src, (size_t)sw * sh * 4); return; }
  for (int y = 0; y < dh; ++y) {
    const uint32_t* row = (const uint32_t*)(src + (size_t)((int64_t)y * sh / dh) * sw * 4);
    uint32_t* out = (uint32_t*)(dst + (size_t)y * dw * 4);
    for (int x = 0; x < dw; ++x) out[x] = row[(int64_t)x * sw / dw];
  }
}

/* Grafik (BGRA, vormultipliert) über Hintergrund (BGRA, deckend) legen: out = g + bg * (1 - a) */
inline void CompositeOver(const uint8_t* g, const uint8_t* bg, uint8_t* out, size_t pixels) {
  for (size_t i = 0; i < pixels; ++i) {
    const uint8_t* s = g + i * 4; const uint8_t* b = bg + i * 4; uint8_t* o = out + i * 4;
    const int ia = 255 - s[3];
    if (ia == 255) { o[0] = b[0]; o[1] = b[1]; o[2] = b[2]; }
    else if (ia == 0) { o[0] = s[0]; o[1] = s[1]; o[2] = s[2]; }
    else {
      o[0] = clamp8(s[0] + (b[0] * ia + 127) / 255);
      o[1] = clamp8(s[1] + (b[1] * ia + 127) / 255);
      o[2] = clamp8(s[2] + (b[2] * ia + 127) / 255);
    }
    o[3] = 255;
  }
}

/* Vormultipliert -> gerade (unshaped) Alpha */
inline void Unpremultiply(uint8_t* p, size_t pixels) {
  for (size_t i = 0; i < pixels; ++i) {
    uint8_t* q = p + i * 4;
    const int a = q[3];
    if (a == 0) { q[0] = q[1] = q[2] = 0; continue; }
    if (a == 255) continue;
    q[0] = clamp8((q[0] * 255 + a / 2) / a);
    q[1] = clamp8((q[1] * 255 + a / 2) / a);
    q[2] = clamp8((q[2] * 255 + a / 2) / a);
  }
}

inline void ForceOpaque(uint8_t* p, size_t pixels) { for (size_t i = 0; i < pixels; ++i) p[i * 4 + 3] = 255; }

inline void SwapRB(uint8_t* p, size_t pixels) { for (size_t i = 0; i < pixels; ++i) std::swap(p[i * 4], p[i * 4 + 2]); }

/* BGRA -> ARGB (Byte-Reihenfolge A R G B) mit Zeilenabstand */
inline void BgraToArgb(const uint8_t* src, uint8_t* dst, int w, int h, int dstRowBytes) {
  for (int y = 0; y < h; ++y) {
    const uint8_t* s = src + (size_t)y * w * 4;
    uint8_t* d = dst + (size_t)y * dstRowBytes;
    for (int x = 0; x < w; ++x) { d[x * 4 + 0] = s[x * 4 + 3]; d[x * 4 + 1] = s[x * 4 + 2]; d[x * 4 + 2] = s[x * 4 + 1]; d[x * 4 + 3] = s[x * 4 + 0]; }
  }
}

/* BGRA (deckend) -> UYVY 8-Bit Videopegel. hd = BT.709 */
inline void BgraToUyvy(const uint8_t* src, uint8_t* dst, int w, int h, int dstRowBytes, bool hd) {
  // Koeffizienten * 1024
  const int yr = hd ? 187 : 263, yg = hd ? 629 : 516, yb = hd ? 63 : 100;
  const int ur = hd ? -103 : -152, ug = hd ? -347 : -298, ub = 450;
  const int vr = 450, vg = hd ? -409 : -377, vb = hd ? -41 : -73;
  for (int y = 0; y < h; ++y) {
    const uint8_t* s = src + (size_t)y * w * 4;
    uint8_t* d = dst + (size_t)y * dstRowBytes;
    for (int x = 0; x + 1 < w; x += 2) {
      const uint8_t* p0 = s + x * 4; const uint8_t* p1 = p0 + 4;
      const int b0 = p0[0], g0 = p0[1], r0 = p0[2], b1 = p1[0], g1 = p1[1], r1 = p1[2];
      const int rA = (r0 + r1) >> 1, gA = (g0 + g1) >> 1, bA = (b0 + b1) >> 1;
      d[x * 2 + 0] = clamp8(128 + ((ur * rA + ug * gA + ub * bA + 512) >> 10));
      d[x * 2 + 1] = clamp8(16 + ((yr * r0 + yg * g0 + yb * b0 + 512) >> 10));
      d[x * 2 + 2] = clamp8(128 + ((vr * rA + vg * gA + vb * bA + 512) >> 10));
      d[x * 2 + 3] = clamp8(16 + ((yr * r1 + yg * g1 + yb * b1 + 512) >> 10));
    }
  }
}

}  // namespace cuepx
