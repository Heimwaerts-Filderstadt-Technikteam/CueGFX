'use strict';
/* Bildschirm-Ausgänge: Grafik-Ausgang randlos im Vollbild auf einem Monitor, Beamer oder HDMI-Ausgang */

class DisplayManager {
  constructor({ BrowserWindow, screen, getPort, log, onConfigChange }) {
    this.BrowserWindow = BrowserWindow;
    this.onConfigChange = onConfigChange || null;
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

  info() {
    const list = this.displays();
    return {
      available: true,
      displays: list.map(({ id, label, primary }) => ({ id, label, primary })),
      outputs: this.config.map((c) => Object.assign({}, c, { connected: !!this.resolve(c) }))
    };
  }

  /* Bildschirm wiederfinden: macOS vergibt IDs (v. a. bei HDMI-Adaptern/Docks) nach Neustart oft neu.
     Reihenfolge: ID → Name + Auflösung → Name → gleiche Position/Größe → einziger Zusatzbildschirm */
  resolve(c) {
    const all = this.screen.getAllDisplays();
    const primary = this.screen.getPrimaryDisplay();
    let d = all.find((x) => String(x.id) === c.displayId);
    if (d) return d;
    const sz = (x) => `${x.size.width}x${x.size.height}`;
    if (c.displayName) d = all.find((x) => x.label === c.displayName && sz(x) === c.displaySize) || all.find((x) => x.label === c.displayName);
    if (!d && c.displayBounds) d = all.find((x) => x.bounds.x === c.displayBounds.x && x.bounds.y === c.displayBounds.y && x.bounds.width === c.displayBounds.width && x.bounds.height === c.displayBounds.height);
    if (!d && c.displayPrimary === false) { const others = all.filter((x) => x.id !== primary.id); if (others.length === 1) d = others[0]; }
    return d || null;
  }
  /* Merkmale des Bildschirms mitspeichern, damit er nach einem Neustart wiedergefunden wird */
  remember(c, d) {
    const primary = this.screen.getPrimaryDisplay();
    const before = JSON.stringify(c);
    c.displayId = String(d.id);
    c.displayName = d.label || '';
    c.displaySize = `${d.size.width}x${d.size.height}`;
    c.displayBounds = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
    c.displayPrimary = d.id === primary.id;
    return JSON.stringify(c) !== before;
  }

  getConfig() { return JSON.parse(JSON.stringify(this.config)); }

  configure(list) {
    this.config = (Array.isArray(list) ? list : []).map((o) => {
      const c = { id: String(o.id || 'd' + Date.now()), enabled: o.enabled !== false, displayId: String(o.displayId || ''), output: String(o.output || '1') };
      const all = this.screen.getAllDisplays();
      const cur = all.find((x) => String(x.id) === c.displayId);
      // gespeicherte Merkmale behalten; ist der Bildschirm angeschlossen, frisch übernehmen
      for (const k of ['displayName', 'displaySize', 'displayBounds', 'displayPrimary']) if (o[k] !== undefined) c[k] = o[k];
      if (cur) this.remember(c, cur);
      return c;
    });
    this.apply();
  }

  apply() {
    const mac = process.platform === 'darwin';
    const wanted = new Map();
    let changed = false;
    for (const c of this.config) {
      if (!c.enabled) continue;
      const d = this.resolve(c);
      if (d) { if (this.remember(c, d)) changed = true; wanted.set(c.id, { c, d }); }
    }
    if (changed && this.onConfigChange) { try { this.onConfigChange(this.getConfig()); } catch (_) {} }
    for (const [id, w] of [...this.windows]) {
      const x = wanted.get(id);
      if (!x || w.key !== `${x.c.displayId}|${x.c.output}`) {
        if (!w.win.isDestroyed()) w.win.destroy();
        this.windows.delete(id);
      } else if (!w.win.isDestroyed()) {
        // Auflösung/Anordnung geändert → Fenster nachziehen
        const b = w.win.getBounds(), db = x.d.bounds;
        if (b.x !== db.x || b.y !== db.y || b.width !== db.width || b.height !== db.height) w.win.setBounds(db);
      }
    }
    for (const { c, d } of wanted.values()) {
      if (this.windows.has(c.id)) continue;
      const win = new this.BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, fullscreen: !mac, backgroundColor: '#000000', show: false,
        // macOS: randloses Fenster über die ganze Fläche inkl. Menüleiste (statt Vollbild-Modus,
        // der die Menüleiste nur ausblendet, solange CueGFX vorne ist)
        enableLargerThanScreen: mac, hasShadow: false, roundedCorners: false, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: !mac,
        skipTaskbar: true, autoHideMenuBar: true, title: `CueGFX Ausgang ${c.output}`,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
      });
      if (mac) {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      }
      win.setBounds(d.bounds);
      win.setMenuBarVisibility(false);
      win.loadURL(`http://127.0.0.1:${this.getPort()}/output/${encodeURIComponent(c.output)}`);
      win.once('ready-to-show', () => { win.showInactive(); if (mac) win.setBounds(d.bounds); });
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
