'use strict';
/* Bildschirm-Ausgänge: Grafik-Ausgang randlos im Vollbild auf einem Monitor, Beamer oder HDMI-Ausgang */

class DisplayManager {
  constructor({ BrowserWindow, screen, getPort, log }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.getPort = getPort;
    this.log = log || console.log;
    this.config = [];
    this.windows = new Map();
    const re = () => this.apply();
    screen.on('display-added', re);
    screen.on('display-removed', re);
    screen.on('display-metrics-changed', re);
  }

  displays() {
    const primary = this.screen.getPrimaryDisplay();
    return this.screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: `${i + 1}: ${d.label || 'Bildschirm'} – ${d.size.width}×${d.size.height}${d.id === primary.id ? ' (Hauptbildschirm)' : ''}`,
      primary: d.id === primary.id,
      bounds: d.bounds
    }));
  }

  info() { return { available: true, displays: this.displays().map(({ id, label, primary }) => ({ id, label, primary })), outputs: this.config }; }

  getConfig() { return JSON.parse(JSON.stringify(this.config)); }

  configure(list) {
    this.config = (Array.isArray(list) ? list : []).map((o) => ({
      id: String(o.id || 'd' + Date.now()), enabled: o.enabled !== false, displayId: String(o.displayId || ''), output: String(o.output || '1')
    }));
    this.apply();
  }

  apply() {
    const displays = this.screen.getAllDisplays();
    const wanted = new Map();
    for (const c of this.config) if (c.enabled) wanted.set(c.id, c);
    for (const [id, w] of [...this.windows]) {
      const c = wanted.get(id);
      if (!c || w.key !== `${c.displayId}|${c.output}` || !displays.find((d) => String(d.id) === c.displayId)) {
        if (!w.win.isDestroyed()) w.win.destroy();
        this.windows.delete(id);
      }
    }
    for (const c of wanted.values()) {
      if (this.windows.has(c.id)) continue;
      const d = displays.find((x) => String(x.id) === c.displayId);
      if (!d) continue;
      const win = new this.BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, fullscreen: process.platform !== 'darwin', simpleFullscreen: process.platform === 'darwin', backgroundColor: '#000000', show: false,
        skipTaskbar: true, autoHideMenuBar: true, title: `CueGFX Ausgang ${c.output}`,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
      });
      win.setBounds(d.bounds);
      win.setMenuBarVisibility(false);
      win.loadURL(`http://127.0.0.1:${this.getPort()}/output/${encodeURIComponent(c.output)}`);
      win.once('ready-to-show', () => { win.showInactive(); if (process.platform === 'darwin') win.setSimpleFullScreen(true); });
      win.on('closed', () => { if (this.windows.get(c.id) && this.windows.get(c.id).win === win) this.windows.delete(c.id); });
      this.windows.set(c.id, { win, key: `${c.displayId}|${c.output}` });
      this.log(`[Bildschirm] Ausgang ${c.output} → ${d.label || d.id}`);
    }
  }

  identify() {
    this.displays().forEach((d, i) => {
      const w = new this.BrowserWindow({
        x: d.bounds.x + Math.round(d.bounds.width / 2 - 200), y: d.bounds.y + Math.round(d.bounds.height / 2 - 150), width: 400, height: 300,
        frame: false, alwaysOnTop: true, transparent: true, focusable: false, skipTaskbar: true, show: false, webPreferences: { sandbox: true }
      });
      const html = `<body style="margin:0;display:grid;place-items:center;height:100vh;background:rgba(229,36,59,.92);color:#fff;font:800 160px system-ui;border-radius:24px">${i + 1}</body>`;
      w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      w.once('ready-to-show', () => w.showInactive());
      setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 3000);
    });
  }

  closeAll() { for (const w of this.windows.values()) if (!w.win.isDestroyed()) w.win.destroy(); this.windows.clear(); }
}

module.exports = { DisplayManager };
