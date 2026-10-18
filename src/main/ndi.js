'use strict';
/* NDI-Ausgänge: jeder Grafik-Ausgang kann als eigene NDI-Quelle im Netzwerk gesendet werden */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createOffscreenRenderer } = require('./offscreen');

const FRAME_RATES = {
  '25': [25, 1], '29.97': [30000, 1001], '30': [30, 1], '50': [50, 1], '59.94': [60000, 1001], '60': [60, 1]
};
const RESOLUTIONS = { '1080': [1920, 1080], '720': [1280, 720], '2160': [3840, 2160], '1080v': [1080, 1920] };

function loadAddon() {
  const candidates = [
    process.env.CUEGFX_NDI_ADDON,
    path.join(__dirname, '..', '..', 'native', 'ndi', 'build', 'Release', 'cuegfx_ndi.node'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'ndi', 'build', 'Release', 'cuegfx_ndi.node')
  ].filter(Boolean);
  let err = null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try { return { addon: require(p) }; } catch (e) { err = e; }
  }
  return { addon: null, error: err ? err.message : 'NDI-Modul ist nicht gebaut (npm run build:native).' };
}

class NdiManager {
  constructor({ BrowserWindow, getPort, log, dialog, libPath }) {
    this.BrowserWindow = BrowserWindow;
    this.getPort = getPort;
    this.dialog = dialog;
    this.log = log || console.log;
    const { addon, error } = loadAddon();
    this.addon = addon;
    this.loadError = error || '';
    this.config = [];
    this.running = new Map();
    this.lastStatus = {};
    this.libPath = libPath || '';
    if (addon && this.libPath && addon.setLibrary) addon.setLibrary(this.libPath);
    this.runtime = addon ? this.addon.info() : { available: false, error: this.loadError };
    if (addon) this.log(this.runtime.available ? `[NDI] Laufzeit ${this.runtime.version} – ${this.runtime.path}` : `[NDI] ${this.runtime.error}`);
  }

  /* Eigenen Pfad zur NDI-Bibliothek setzen (z. B. aus einem NDI-Programm) */
  setLibrary(p) {
    if (!this.addon) throw new Error(this.loadError);
    this.libPath = String(p || '').trim();
    if (this.runtime.available && this.libPath && this.libPath !== this.runtime.path) {
      // Bereits geladene Laufzeit kann nicht gewechselt werden
      this.log('[NDI] Neuer Pfad wird nach einem Neustart von CueGFX verwendet');
    }
    if (this.addon.setLibrary) this.addon.setLibrary(this.libPath);
    this.runtime = this.addon.info();
    this.apply();
    return this.runtime;
  }

  async pickLibrary(parentWin) {
    if (!this.dialog) throw new Error('Dateiauswahl nicht verfügbar');
    const filters = process.platform === 'darwin' ? [{ name: 'NDI-Bibliothek', extensions: ['dylib'] }] : process.platform === 'win32' ? [{ name: 'NDI-Bibliothek', extensions: ['dll'] }] : [{ name: 'NDI-Bibliothek', extensions: ['so', '6', '5'] }];
    const r = await this.dialog.showOpenDialog(parentWin, {
      title: 'NDI-Bibliothek wählen (libndi)', properties: ['openFile', 'showHiddenFiles', 'treatPackageAsDirectory'],
      defaultPath: process.platform === 'darwin' ? '/Applications' : undefined, filters
    });
    if (r.canceled || !r.filePaths.length) return null;
    this.setLibrary(r.filePaths[0]);
    return r.filePaths[0];
  }

  get available() { return !!this.addon; }

  info() {
    if (!this.addon) return { available: false, reason: this.loadError };
    if (!this.runtime.available) this.runtime = this.addon.info();
    const status = {};
    for (const [id, r] of this.running) {
      try { status[id] = Object.assign({}, this.addon.status(r.handle), r.renderer.stats()); } catch (e) { status[id] = { running: false, error: e.message }; }
    }
    for (const [id, s] of Object.entries(this.lastStatus)) if (!status[id]) status[id] = s;
    return {
      available: true,
      runtime: this.runtime.available,
      runtimeVersion: this.runtime.version || '',
      reason: this.runtime.available ? '' : this.runtime.error,
      runtimePath: this.runtime.path || '',
      libPath: this.libPath,
      searched: this.runtime.available ? [] : (this.runtime.searched || []),
      host: os.hostname().replace(/\.local$/, '').toUpperCase(),
      outputs: this.config,
      status
    };
  }

  getConfig() { return JSON.parse(JSON.stringify(this.config)); }

  configure(list) {
    if (!this.addon) throw new Error(this.loadError);
    this.runtime = this.addon.info();
    this.config = (Array.isArray(list) ? list : []).map((o, i) => ({
      id: String(o.id || 'ndi' + Date.now().toString(36) + i),
      enabled: o.enabled !== false,
      name: String(o.name || `CueGFX ${i + 1}`).replace(/[^\w äöüÄÖÜß\-().]/g, '').slice(0, 60) || `CueGFX ${i + 1}`,
      output: String(o.output || '1'),
      resolution: RESOLUTIONS[o.resolution] ? o.resolution : '1080',
      fps: FRAME_RATES[o.fps] ? o.fps : '50',
      alpha: o.alpha !== false,
      groups: String(o.groups || '').slice(0, 120),
      audio: !!o.audio
    }));
    const names = new Set();
    for (const c of this.config) {
      if (!c.enabled) continue;
      if (names.has(c.name)) { c.enabled = false; this.lastStatus[c.id] = { running: false, error: 'Dieser NDI-Name wird bereits verwendet' }; }
      names.add(c.name);
    }
    this.apply();
  }

  apply() {
    for (const [id, r] of [...this.running]) {
      const c = this.config.find((x) => x.id === id);
      if (!c || !c.enabled || JSON.stringify(c) !== JSON.stringify(r.cfg)) this.stopOne(id);
    }
    for (const c of this.config) {
      if (!c.enabled || this.running.has(c.id)) continue;
      try { this.startOne(c); delete this.lastStatus[c.id]; } catch (e) {
        this.lastStatus[c.id] = { running: false, error: e.message };
        this.log(`[NDI] ${c.name}: ${e.message}`);
      }
    }
  }

  startOne(c) {
    if (!this.runtime.available) throw new Error(this.runtime.error || 'NDI-Laufzeit nicht gefunden');
    const [width, height] = RESOLUTIONS[c.resolution];
    const [fpsN, fpsD] = FRAME_RATES[c.fps];
    const handle = this.addon.create({ name: c.name, groups: c.groups, width, height, fpsN, fpsD, alpha: c.alpha });
    const q = new URLSearchParams({ engine: 'ndi', audio: c.audio ? '1' : '0' });
    if (c.alpha) q.set('transparent', '1');
    const url = `http://127.0.0.1:${this.getPort()}/output/${encodeURIComponent(c.output)}?${q}`;
    const renderer = createOffscreenRenderer({
      BrowserWindow: this.BrowserWindow, url, width, height, fps: fpsN / fpsD, audio: c.audio, log: this.log, tag: 'NDI',
      onFrame: (buf, w, h) => this.addon.push(handle, buf, w, h)
    });
    this.running.set(c.id, { handle, renderer, cfg: JSON.parse(JSON.stringify(c)) });
    this.log(`[NDI] Sende „${c.name}“ (${width}×${height} @ ${c.fps}) ← Ausgang ${c.output}`);
  }

  stopOne(id) {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    r.renderer.stop();
    try { this.addon.stop(r.handle); } catch (_) {}
  }

  stopAll() { for (const id of [...this.running.keys()]) this.stopOne(id); }
}

module.exports = { NdiManager, FRAME_RATES, RESOLUTIONS };
