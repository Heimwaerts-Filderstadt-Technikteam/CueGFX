'use strict';
/* DeckLink-Manager (Electron-Hauptprozess): rendert Grafik-Ausgänge offscreen und schickt die Frames an das native Addon */
const path = require('path');
const fs = require('fs');

function loadAddon() {
  const candidates = [
    process.env.CUEGFX_DECKLINK_ADDON,
    path.join(__dirname, '..', '..', 'native', 'decklink', 'build', 'Release', 'cuegfx_decklink.node'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'decklink', 'build', 'Release', 'cuegfx_decklink.node')
  ].filter(Boolean);
  let lastErr = null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try { return { addon: require(p), path: p }; } catch (e) { lastErr = e; }
  }
  return { addon: null, error: lastErr ? lastErr.message : 'DeckLink-Modul ist nicht gebaut (npm run build:decklink mit installiertem Blackmagic DeckLink SDK).' };
}

class DeckLinkManager {
  constructor({ BrowserWindow, getPort, getProject, log }) {
    this.BrowserWindow = BrowserWindow;
    this.getPort = getPort;
    this.getProject = getProject;
    this.log = log || console.log;
    const { addon, error } = loadAddon();
    this.addon = addon;
    this.loadError = error || '';
    this.devices = [];
    this.deviceError = '';
    this.config = [];
    this.running = new Map(); // id -> { handle, win, cfg, fpsCounter }
    this.lastStatus = {};
    if (this.addon) {
      try { this.version = this.addon.version(); } catch (_) { this.version = {}; }
      this.rescan();
    }
  }

  get available() { return !!this.addon; }

  async rescan() {
    if (!this.addon) return;
    try {
      const r = this.addon.listDevices();
      this.devices = r.devices || [];
      this.deviceError = r.error || '';
    } catch (e) { this.devices = []; this.deviceError = e.message; }
  }

  getConfig() { return JSON.parse(JSON.stringify(this.config)); }

  info() {
    if (!this.addon) return { available: false, reason: this.loadError };
    const status = {};
    for (const [id, r] of this.running) {
      try {
        const s = this.addon.status(r.handle);
        status[id] = Object.assign({}, s, { renderFps: r.renderFps || 0, frames: s.completed, captureMode: !!r.captureMode });
      } catch (e) { status[id] = { running: false, error: e.message }; }
    }
    for (const [id, s] of Object.entries(this.lastStatus)) if (!status[id]) status[id] = s;
    return {
      available: true,
      reason: this.deviceError,
      sdkVersion: this.version && this.version.sdk,
      driverVersion: this.version && this.version.driver,
      devices: this.devices.map((d) => ({ key: d.key, name: d.name, model: d.model, canOutput: d.canOutput, canInput: d.canInput, externalKeying: d.externalKeying, internalKeying: d.internalKeying, outputModes: d.outputModes.map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height, fps: m.fps })) })),
      outputs: this.config,
      status
    };
  }

  device(key) { return this.devices.find((d) => d.key === key) || null; }

  async configure(list) {
    if (!this.addon) throw new Error(this.loadError);
    const clean = (Array.isArray(list) ? list : []).map((o) => ({
      id: String(o.id || 'dl' + Date.now().toString(36)),
      enabled: o.enabled !== false,
      deviceKey: String(o.deviceKey || ''),
      modeId: String(o.modeId || ''),
      keying: ['none', 'external', 'internal', 'software'].includes(o.keying) ? o.keying : 'none',
      inputDeviceKey: String(o.inputDeviceKey || ''),
      output: String(o.output || '1'),
      alpha: o.alpha === 'straight' ? 'straight' : 'premultiplied',
      pixelFormat: ['bgra', 'argb', 'yuv', 'auto'].includes(o.pixelFormat) ? o.pixelFormat : 'auto',
      swapRB: !!o.swapRB,
      keyLevel: Math.max(0, Math.min(255, Number(o.keyLevel === undefined ? 255 : o.keyLevel))),
      localAudio: !!o.localAudio,
      outputMode: o.outputMode === 'sync' ? 'sync' : 'auto'
    }));
    // Gleiche Geräte doppelt? Zweite Belegung deaktivieren.
    const used = new Set();
    for (const o of clean) {
      if (!o.enabled) continue;
      if (used.has(o.deviceKey)) { o.enabled = false; this.lastStatus[o.id] = { running: false, error: 'Gerät ist bereits einer anderen Ausgabe zugeordnet' }; }
      used.add(o.deviceKey);
    }
    this.config = clean;
    await this.rescan();
    await this.applyAll();
  }

  async applyAll() {
    // Alles stoppen, was nicht mehr (identisch) konfiguriert ist
    for (const [id, r] of [...this.running]) {
      const c = this.config.find((x) => x.id === id);
      if (!c || !c.enabled || JSON.stringify(c) !== JSON.stringify(r.cfg)) this.stopOne(id);
    }
    for (const c of this.config) {
      if (!c.enabled || this.running.has(c.id)) continue;
      try { this.startOne(c); delete this.lastStatus[c.id]; } catch (e) {
        this.lastStatus[c.id] = { running: false, error: e.message };
        this.log(`[DeckLink] ${c.id}: ${e.message}`);
      }
    }
  }

  startOne(c) {
    const dev = this.device(c.deviceKey);
    if (!dev) throw new Error('Gerät nicht gefunden – angeschlossen und Desktop Video installiert?');
    if (!c.modeId) throw new Error('Kein Videoformat gewählt');
    const mode = dev.outputModes.find((m) => m.id === c.modeId);
    if (!mode) throw new Error('Videoformat wird von diesem Gerät nicht unterstützt');
    let inputDeviceIndex = -1;
    if (c.keying === 'software') {
      const inDev = this.device(c.inputDeviceKey);
      if (!inDev) throw new Error('Eingangsgerät für den Live-Hintergrund nicht gefunden');
      inputDeviceIndex = inDev.index;
    }
    const handle = this.addon.createOutput({
      deviceIndex: dev.index, mode: c.modeId, keying: c.keying, keyLevel: c.keyLevel,
      inputDeviceIndex, pixelFormat: c.pixelFormat, straightAlpha: c.alpha === 'straight', swapRB: c.swapRB, preroll: 3, outputMode: c.outputMode
    });
    const size = this.addon.start(handle);
    const w = size.width || mode.width, h = size.height || mode.height;

    const keyed = c.keying !== 'none';
    const q = new URLSearchParams({ engine: 'decklink', audio: c.localAudio ? '1' : '0' });
    if (keyed) q.set('transparent', '1');
    const url = `http://127.0.0.1:${this.getPort()}/output/${encodeURIComponent(c.output)}?${q}`;
    const win = new this.BrowserWindow({
      width: w, height: h, useContentSize: true, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      enableLargerThanScreen: true, paintWhenInitiallyHidden: true,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
    });
    win.setContentSize(w, h);
    win.webContents.setAudioMuted(!c.localAudio);
    // Bildrate an das Videoformat koppeln (Chromium-Offscreen max. 240 fps)
    win.webContents.setFrameRate(Math.min(240, Math.max(1, Math.ceil(mode.fps || 50))));
    const r = { handle, win, cfg: JSON.parse(JSON.stringify(c)), frames: 0, renderFps: 0, lastTick: Date.now() };
    win.webContents.on('paint', (_e, _dirty, image) => {
      if (!this.running.has(c.id) || r.captureMode) return;
      pushImage(image);
    });
    win.webContents.on('render-process-gone', () => { this.log('[DeckLink] Renderer abgestürzt, lade neu'); setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url); }, 500); });
    win.webContents.on('did-fail-load', () => setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url); }, 1000));
    win.loadURL(url);
    const pushImage = (image) => {
      const s = image.getSize();
      if (!s.width || !s.height) return;
      try { this.addon.push(handle, image.toBitmap(), s.width, s.height); } catch (_) {}
      r.frames++;
    };
    r.fpsTimer = setInterval(() => {
      const now = Date.now();
      r.renderFps = Math.round((r.frames * 1000) / Math.max(1, now - r.lastTick));
      r.frames = 0; r.lastTick = now;
      if (win.isDestroyed()) return;
      // Ohne Änderungen malt Chromium nichts – regelmäßig neu zeichnen lassen, damit das Bild aktuell bleibt
      win.webContents.invalidate();
      // Absicherung: Kommen keine Offscreen-Frames an, Bilder per Screenshot abholen
      r.silentSeconds = r.renderFps === 0 ? (r.silentSeconds || 0) + 1 : 0;
      if (r.silentSeconds >= 3 && !r.captureTimer) {
        this.log('[DeckLink] Offscreen-Rendering liefert keine Bilder – nutze Bildabgriff');
        r.captureMode = true;
        let busy = false;
        r.captureTimer = setInterval(() => {
          if (busy || win.isDestroyed()) return;
          busy = true;
          win.webContents.capturePage().then((img) => { pushImage(img); }).catch(() => {}).finally(() => { busy = false; });
        }, Math.round(1000 / Math.min(30, Math.max(10, mode.fps || 25))));
      }
    }, 1000);
    this.running.set(c.id, r);
    this.log(`[DeckLink] ${dev.name}: ${mode.name} ${c.keying} → Ausgang ${c.output}`);
  }

  stopOne(id) {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    clearInterval(r.fpsTimer);
    clearInterval(r.captureTimer);
    try { this.addon.stop(r.handle); } catch (_) {}
    if (r.win && !r.win.isDestroyed()) r.win.destroy();
  }

  stopAll() { for (const id of [...this.running.keys()]) this.stopOne(id); }
}

module.exports = { DeckLinkManager, loadAddon };
