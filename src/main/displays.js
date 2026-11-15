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
    const all = this.screen.getAllDisplays();
    const dup = (d) => all.filter((x) => x.label === d.label).length > 1;
    const where = (d) => {
      if (d.id === primary.id) return 'Hauptbildschirm';
      const p = primary.bounds, cx = d.bounds.x + d.bounds.width / 2, cy = d.bounds.y + d.bounds.height / 2;
      const dx = cx - (p.x + p.width / 2), dy = cy - (p.y + p.height / 2);
      return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'rechts vom Hauptbildschirm' : 'links vom Hauptbildschirm') : (dy > 0 ? 'unter dem Hauptbildschirm' : 'über dem Hauptbildschirm');
    };
    return all.map((d, i) => ({
      id: String(d.id),
      label: `${i + 1}: ${d.label || 'Bildschirm'} – ${d.size.width}×${d.size.height} · ${where(d)}${dup(d) ? ` (ID ${d.id})` : ''}`,
      primary: d.id === primary.id,
      bounds: d.bounds
    }));
  }

  info() {
    const list = this.displays();
    return {
      available: true,
      displays: list.map(({ id, label, primary }) => ({ id, label, primary })),
      outputs: this.config.map((c) => {
        const d = this.resolve(c), w = this.windows.get(c.id);
        let actual = '';
        if (w && !w.win.isDestroyed()) { try { const m = this.screen.getDisplayMatching(w.win.getBounds()); actual = String(m.id); } catch (_) {} }
        return Object.assign({}, c, { connected: !!d, actualId: actual, wrongDisplay: !!(d && actual && actual !== String(d.id)) });
      })
    };
  }

  /* Bildschirm wiederfinden. macOS vergibt IDs bei Geräten ohne Seriennummer (Videomischer, Capture,
     HDMI-Adapter) nach einem Neustart neu – teils sogar die ID eines anderen Bildschirms. Deshalb nicht
     blind der ID vertrauen, sondern alle gespeicherten Merkmale bewerten. */
  resolve(c) {
    const all = this.screen.getAllDisplays();
    const primary = this.screen.getPrimaryDisplay();
    const sz = (x) => `${x.size.width}x${x.size.height}`;
    const sameBounds = (x) => c.displayBounds && x.bounds.x === c.displayBounds.x && x.bounds.y === c.displayBounds.y && x.bounds.width === c.displayBounds.width && x.bounds.height === c.displayBounds.height;
    const nameUnique = c.displayName && all.filter((x) => x.label === c.displayName).length === 1;
    let best = null, bestScore = 0;
    for (const x of all) {
      let sc = 0;
      if (String(x.id) === c.displayId) sc += 4;
      if (c.displayName && x.label === c.displayName) sc += nameUnique ? 3 : 1;
      if (c.displaySize && sz(x) === c.displaySize) sc += 2;
      if (sameBounds(x)) sc += 2;
      if (c.displayPrimary !== undefined) sc += (x.id === primary.id) === c.displayPrimary ? 1 : -6; // Zusatzbildschirm nie auf den Hauptbildschirm legen
      if (sc > bestScore) { best = x; bestScore = sc; }
    }
    if (best && bestScore >= 3) return best;
    // Letzter Ausweg: genau ein Zusatzbildschirm vorhanden
    if (c.displayPrimary === false) { const others = all.filter((x) => x.id !== primary.id); if (others.length === 1) return others[0]; }
    return null;
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
    const prev = new Map(this.config.map((c) => [c.id, c]));
    this.config = (Array.isArray(list) ? list : []).map((o) => {
      const c = { id: String(o.id || 'd' + Date.now()), enabled: o.enabled !== false, displayId: String(o.displayId || ''), output: String(o.output || '1') };
      for (const k of ['displayName', 'displaySize', 'displayBounds', 'displayPrimary']) if (o[k] !== undefined) c[k] = o[k];
      // Nur wenn in der Steuerung ein anderer Bildschirm gewählt wurde (oder der Eintrag neu ist), dessen
      // Merkmale frisch übernehmen. Beim Programmstart NICHT der gespeicherten ID trauen – die kann
      // inzwischen zu einem anderen Bildschirm gehören; das entscheidet resolve() anhand aller Merkmale.
      const p = prev.get(c.id);
      const userPicked = (p && p.displayId !== c.displayId) || (!p && o.displayName === undefined);
      const cur = this.screen.getAllDisplays().find((x) => String(x.id) === c.displayId);
      if (userPicked && cur) this.remember(c, cur);
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
        enableLargerThanScreen: mac, hasShadow: false, roundedCorners: false, resizable: false,
        minimizable: false, maximizable: false, fullscreenable: !mac,
        skipTaskbar: true, autoHideMenuBar: true, title: `CueGFX Ausgang ${c.output}`,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
      });
      win.setBounds(d.bounds);
      win.setMenuBarVisibility(false);
      win.loadURL(`http://127.0.0.1:${this.getPort()}/output/${encodeURIComponent(c.output)}`);
      win.once('ready-to-show', () => {
        win.showInactive();
        // erst nach dem Anzeigen über die Menüleiste heben, dann Position kontrollieren und ggf. korrigieren
        if (mac) win.setAlwaysOnTop(true, 'screen-saver');
        this.place(win, d.id, c.output);
      });
      win.on('closed', () => { if (this.windows.get(c.id) && this.windows.get(c.id).win === win) this.windows.delete(c.id); });
      this.windows.set(c.id, { win, key: `${c.displayId}|${c.output}` });
      this.log(`[Bildschirm] Ausgang ${c.output} → ${d.label || d.id}`);
    }
  }

  /* Sitzt das Fenster wirklich auf dem gewünschten Bildschirm? macOS verschiebt Fenster gelegentlich
     beim Anzeigen – dann mehrfach nachsetzen. */
  place(win, displayId, output) {
    let n = 0;
    const check = () => {
      if (win.isDestroyed()) return;
      const d = this.screen.getAllDisplays().find((x) => x.id === displayId);
      if (!d) return;
      const b = win.getBounds(), db = d.bounds;
      const on = this.screen.getDisplayMatching(b).id === displayId;
      if (!on || b.x !== db.x || b.y !== db.y || b.width !== db.width || b.height !== db.height) {
        win.setBounds(db);
        if (!on) this.log(`[Bildschirm] Ausgang ${output} lag auf falschem Bildschirm – korrigiert (Versuch ${n + 1})`);
      }
      if (++n < 5) setTimeout(check, [150, 500, 1200, 3000][n - 1]);
    };
    check();
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
