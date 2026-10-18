'use strict';
/* CueGFX Server: HTTP + WebSocket, Befehls-Dispatcher, REST-API, Synchronisation aller Ausgänge */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { WsServer } = require('./websocket');
const { Store, uid, mediaKind } = require('./store');
const { createZip, readZip } = require('./zip');
const QR = require('./qrcode');
const { fetchSheet } = require('./sheets');
const { TwitchChat } = require('./twitch');
const { createAudience } = require('./audience');
const Types = require('../../public/shared/graphic-types.js');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const VERSION = require('../../package.json').version;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.zip': 'application/zip'
};

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

class CueServer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.store = new Store(opts.dataDir || path.join(os.homedir(), '.cuegfx'));
    this.port = opts.port || this.store.config.port || 4001;
    this.host = opts.host || '0.0.0.0';
    this.hooks = opts.hooks || {};
    this.autoHideTimers = new Map();
    this.sheetTimers = new Map();
    this.sheetValues = {};
    this.audience = createAudience(this);
    this._audDirty = true;
    this._audTimer = null;
    this.chatLog = [];
    this.twitch = new TwitchChat();
    this.twitch.on('message', (m) => {
      this.chatLog.push(m);
      if (this.chatLog.length > 300) this.chatLog.shift();
      this._broadcastControl({ t: 'chat', msg: m });
    });
    this.twitch.on('status', (s) => this._broadcastControl({ t: 'chatStatus', status: s }));
    this._bcTimer = null;
    this._hwJson = '';
  }

  get project() { return this.store.project; }

  /* ---------- Start / Stop ---------- */
  start() {
    return new Promise((resolve, reject) => {
      this.http = http.createServer((req, res) => this._handle(req, res).catch((e) => this._error(res, e)));
      this.ws = new WsServer(this.http, { path: '/ws', verify: (req, url) => this._wsAllowed(req, url) });
      this.ws.on('connection', (c) => this._wsConnection(c));
      this.http.once('error', reject);
      this.http.listen(this.port, this.host, () => {
        this.http.off('error', reject);
        this._restartSheets();
        this._restoreAutoHide();
        this.hwTimer = setInterval(() => this._pushHardware(), 1000);
        resolve(this.port);
      });
    });
  }

  async stop() {
    clearInterval(this.hwTimer);
    for (const t of this.sheetTimers.values()) clearInterval(t);
    for (const t of this.autoHideTimers.values()) clearTimeout(t);
    this.twitch.disconnect();
    this.store.saveProjectNow();
    if (this.ws) this.ws.close();
    if (this.http) await new Promise((r) => this.http.close(() => r()));
  }

  lanUrls() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${this.port}`);
    }
    return out;
  }

  /* ---------- Zugriffsschutz ---------- */
  _pinOk(req, url) {
    const pin = this.store.config.accessPin;
    if (!pin) return true;
    const ra = req.socket.remoteAddress || '';
    if (ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1') return true;
    const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('cuepin='));
    const given = req.headers['x-cue-pin'] || (url && url.searchParams.get('pin')) || (cookie ? decodeURIComponent(cookie.slice(7)) : '');
    return String(given) === String(pin);
  }

  _wsAllowed(req, url) {
    const role = url.searchParams.get('role') || 'control';
    if (role === 'output' || role === 'audience') return true;
    return this._pinOk(req, url);
  }

  /* ---------- WebSocket ---------- */
  _wsConnection(c) {
    c.role = c.query.get('role') || 'control';
    c.outputId = c.query.get('output') || '';
    c.on('message', (msg) => {
      let m;
      try { m = JSON.parse(msg); } catch (_) { return; }
      if (m.t === 'ping') { c.send(JSON.stringify({ t: 'pong', id: m.id, serverTime: Date.now() })); return; }
      if (m.t !== 'cmd') return;
      const allowed = c.role === 'control' ||
        (c.role === 'output' && ['media.ended'].includes(m.cmd)) ||
        (c.role === 'audience' && ['qa.submit', 'qa.like', 'poll.vote'].includes(m.cmd));
      let reply;
      try {
        if (!allowed) throw new HttpError(403, 'Nicht erlaubt');
        if (c.role === 'audience') {
          // Einfacher Schutz gegen Fluten: höchstens ein Befehl pro Sekunde, Fragen alle 5 s
          const now = Date.now();
          const key = m.cmd === 'qa.submit' ? 'lastQ' : m.cmd === 'qa.like' ? 'lastL' : 'lastV';
          const gap = m.cmd === 'qa.submit' ? 5000 : m.cmd === 'qa.like' ? 200 : 250;
          if (c[key] && now - c[key] < gap) throw new HttpError(429, 'Bitte einen Moment warten');
          c[key] = now;
          // Kennung des Geräts immer aus der Verbindung nehmen (nicht frei wählbar)
          m.args = Object.assign({}, m.args, { voter: c.voter });
        }
        reply = { t: 'res', id: m.id, ok: true, result: this.exec(m.cmd, m.args || {}, { role: c.role }) };
      } catch (e) {
        reply = { t: 'res', id: m.id, ok: false, error: e.message };
      }
      if (m.id !== undefined) c.send(JSON.stringify(reply));
    });
    if (c.role === 'audience') {
      c.voter = String(c.query.get('voter') || '').replace(/[^\w-]/g, '').slice(0, 64) || ('anon-' + Math.random().toString(36).slice(2));
      this._sendAudience(c, JSON.stringify(this.audience.publicState()));
    }
    else {
      c.send(JSON.stringify(this._statePayload()));
      if (c.role === 'control') {
        c.send(JSON.stringify({ t: 'chatLog', log: this.chatLog, status: this.twitch.status, channel: this.twitch.channel }));
        if (this._hwJson) c.send(this._hwJson);
      }
    }
  }

  _statePayload() {
    if (!this._lanCache || Date.now() - this._lanCache.t > 10000) this._lanCache = { t: Date.now(), urls: this.lanUrls() };
    return { t: 'state', serverTime: Date.now(), project: this.project, vars: this.variables(), info: { version: VERSION, port: this.port, lan: this._lanCache.urls } };
  }

  _sendAudience(c, publicJson) {
    const mine = JSON.stringify(Object.assign({ t: 'audienceMe' }, this.audience.personalState(c.voter)));
    c.send(publicJson);
    if (c._lastMine !== mine) { c._lastMine = mine; c.send(mine); }
  }

  _broadcastAudience() {
    if (this._audTimer) return;
    // Publikum gedrosselt aktualisieren (viele Geräte möglich)
    this._audTimer = setTimeout(() => {
      this._audTimer = null;
      if (!this._audDirty) return;
      this._audDirty = false;
      const pub = JSON.stringify(this.audience.publicState());
      for (const c of this.ws.clients) if (c.role === 'audience') this._sendAudience(c, pub);
    }, 200);
  }

  changed() {
    this.store.scheduleSave();
    if (this._audDirty) this._broadcastAudience();
    if (this._bcTimer) return;
    this._bcTimer = setTimeout(() => {
      this._bcTimer = null;
      const s = JSON.stringify(this._statePayload());
      this.ws.broadcast(s, (c) => c.role !== 'audience');
      this.emit('state', this.project);
    }, 16);
  }

  _broadcastControl(obj) { if (this.ws) this.ws.broadcast(JSON.stringify(obj), (c) => c.role === 'control'); }

  _pushHardware() {
    const hw = { t: 'hw', decklink: this.hooks.decklink ? this.hooks.decklink.info() : { available: false, reason: 'Nur in der Desktop-App verfügbar' }, displays: this.hooks.displays ? this.hooks.displays.info() : { available: false }, ndi: this.hooks.ndi ? this.hooks.ndi.info() : { available: false, reason: 'Nur in der Desktop-App verfügbar' } };
    const s = JSON.stringify(hw);
    if (s !== this._hwJson) { this._hwJson = s; this._broadcastControl(hw); }
  }

  /* ---------- Variablen ---------- */
  variables() {
    const p = this.project, v = {};
    for (const [k, val] of Object.entries(p.variables.text)) v[k] = String(val);
    for (const [k, l] of Object.entries(p.variables.lists)) {
      const items = l.items || [];
      v[k] = items[l.index || 0] !== undefined ? String(items[l.index || 0]) : '';
      items.forEach((it, i) => { v[`${k}[${i}]`] = String(it); });
      v[`${k}#`] = String((l.index || 0) + 1);
      v[`${k}.count`] = String(items.length);
    }
    for (const s of p.sheets) {
      const vals = this.sheetValues[s.id] || s.cache;
      if (!vals) continue;
      const pre = s.name || 'sheet';
      for (const [cell, val] of Object.entries(vals.cells || {})) v[`${pre}.${cell}`] = val;
      for (const [key, val] of Object.entries(vals.keys || {})) v[`${pre}.${key}`] = val;
    }
    return v;
  }

  /* ---------- Grafik-Helfer ---------- */
  findGraphic(ref) {
    const g = this.project.graphics.find((x) => x.id === ref) ||
      this.project.graphics.find((x) => x.name.toLowerCase() === String(ref).toLowerCase());
    if (!g) throw new HttpError(404, 'Grafik nicht gefunden: ' + ref);
    return g;
  }

  _setLive(g, on) {
    if (on) {
      g.live = true;
      g.shownAt = Date.now();
      this._scheduleAutoHide(g);
    } else {
      g.live = false;
      clearTimeout(this.autoHideTimers.get(g.id));
      this.autoHideTimers.delete(g.id);
    }
  }

  _scheduleAutoHide(g) {
    clearTimeout(this.autoHideTimers.get(g.id));
    let secs = Number(g.data.autoHide) || 0;
    if (g.type === 'celebration') secs = secs || (Number(g.data.duration) || 6) + 1.5;
    if (secs > 0) {
      const remaining = secs * 1000 - (Date.now() - (g.shownAt || Date.now()));
      this.autoHideTimers.set(g.id, setTimeout(() => {
        this.autoHideTimers.delete(g.id);
        if (g.live) { g.live = false; this.changed(); }
      }, Math.max(0, remaining)));
    }
  }

  _restoreAutoHide() { for (const g of this.project.graphics) if (g.live) this._scheduleAutoHide(g); }

  _timer(g) {
    if (!g.data.timer || typeof g.data.timer !== 'object') g.data.timer = Types.defaultTimer(300);
    return g.data.timer;
  }

  _stepCount(g) {
    if (g.type === 'lyrics') return String(g.data.text || '').split(/\n\s*\n/).filter((s) => s.trim()).length;
    if (g.type === 'nnt') return (g.data.items || []).length;
    if (g.type === 'ticker') return (g.data.items || []).length;
    return 0;
  }

  /* ---------- Befehle (gemeinsam für WebSocket und REST) ---------- */
  exec(cmd, a = {}) {
    const p = this.project;
    const now = Date.now();
    const done = (r) => { this.changed(); return r === undefined ? true : r; };
    switch (cmd) {
      /* Grafiken */
      case 'graphic.add': {
        const g = this.store.makeGraphic(a.type, a.name, a.outputs);
        if (a.data) Object.assign(g.data, a.data);
        const idx = a.after ? p.graphics.findIndex((x) => x.id === a.after) : -1;
        if (idx >= 0) p.graphics.splice(idx + 1, 0, g); else p.graphics.push(g);
        return done({ id: g.id });
      }
      case 'graphic.duplicate': {
        const src = this.findGraphic(a.id);
        const g = JSON.parse(JSON.stringify(src));
        g.id = uid(8); g.name = src.name + ' (Kopie)'; g.live = false; g.preview = false;
        p.graphics.splice(p.graphics.indexOf(src) + 1, 0, g);
        return done({ id: g.id });
      }
      case 'graphic.remove': {
        const g = this.findGraphic(a.id);
        this._setLive(g, false);
        p.graphics.splice(p.graphics.indexOf(g), 1);
        return done();
      }
      case 'graphic.reorder': {
        const order = new Map((a.ids || []).map((id, i) => [id, i]));
        p.graphics.sort((x, y) => (order.has(x.id) ? order.get(x.id) : 1e9) - (order.has(y.id) ? order.get(y.id) : 1e9));
        return done();
      }
      case 'graphic.update': {
        const g = this.findGraphic(a.id);
        if (a.name !== undefined) g.name = String(a.name).slice(0, 120);
        if (Array.isArray(a.outputs)) g.outputs = a.outputs.map(String);
        if (a.data && typeof a.data === 'object') {
          for (const [k, v] of Object.entries(a.data)) g.data[k] = coerce(g.type, k, v);
          if ('autoHide' in a.data && g.live) this._scheduleAutoHide(g);
        }
        return done();
      }
      case 'graphic.show': { const g = this.findGraphic(a.id); this._setLive(g, true); return done(); }
      case 'graphic.hide': { const g = this.findGraphic(a.id); this._setLive(g, false); return done(); }
      case 'graphic.toggle': { const g = this.findGraphic(a.id); this._setLive(g, !g.live); return done({ live: g.live }); }
      case 'graphic.preview': {
        const g = this.findGraphic(a.id);
        g.preview = a.on === undefined ? !g.preview : !!a.on;
        if (g.preview) g.previewAt = now;
        return done({ preview: g.preview });
      }
      case 'take': {
        const pv = p.graphics.filter((g) => g.preview);
        if (p.settings.takeMode === 'replace') for (const g of p.graphics) if (g.live && !g.preview) this._setLive(g, false);
        for (const g of pv) { this._setLive(g, true); g.preview = false; }
        return done({ count: pv.length });
      }
      case 'preview.clear': for (const g of p.graphics) g.preview = false; return done();
      case 'hideAll': {
        for (const g of p.graphics) if (g.live && (!a.output || g.outputs.includes(String(a.output)))) this._setLive(g, false);
        return done();
      }
      case 'media.ended': {
        const g = p.graphics.find((x) => x.id === a.id);
        if (g && g.live && g.data.hideOnEnd && (!a.shownAt || a.shownAt === g.shownAt)) { this._setLive(g, false); return done(); }
        return false;
      }

      /* Timer */
      case 'timer.start': case 'timer.pause': case 'timer.toggle': case 'timer.reset': case 'timer.set': case 'timer.add': case 'timer.mode': {
        const g = this.findGraphic(a.id); const t = this._timer(g);
        const op = cmd.split('.')[1];
        const pause = () => { if (t.running) { t.elapsedBefore += now - t.startedAt; t.running = false; } };
        const start = () => { if (!t.running) { t.running = true; t.startedAt = now; } };
        if (op === 'start') start();
        else if (op === 'pause') pause();
        else if (op === 'toggle') { if (t.running) pause(); else start(); }
        else if (op === 'reset') { t.running = false; t.elapsedBefore = 0; t.startedAt = 0; }
        else if (op === 'set') {
          const secs = parseTime(a.seconds !== undefined ? a.seconds : a.value);
          if (t.mode === 'up' && a.elapsed) { t.elapsedBefore = secs * 1000; if (t.running) t.startedAt = now; }
          else { t.duration = secs; t.elapsedBefore = 0; t.startedAt = now; }
        } else if (op === 'add') {
          const secs = Number(a.seconds) || 0;
          if (t.mode === 'up') t.elapsedBefore = Math.max(0, t.elapsedBefore + secs * 1000);
          else t.duration = Math.max(0, t.duration + secs);
        } else if (op === 'mode') { pause(); t.mode = a.mode === 'up' ? 'up' : 'down'; t.elapsedBefore = 0; }
        return done();
      }

      /* Spielstand */
      case 'score.add': {
        const g = this.findGraphic(a.id);
        const key = String(a.team).toLowerCase() === 'b' ? 'scoreB' : 'scoreA';
        g.data[key] = (Number(g.data[key]) || 0) + (Number(a.delta) || 1);
        return done({ value: g.data[key] });
      }
      case 'score.set': {
        const g = this.findGraphic(a.id);
        if (a.a !== undefined) g.data.scoreA = Number(a.a) || 0;
        if (a.b !== undefined) g.data.scoreB = Number(a.b) || 0;
        return done();
      }
      case 'score.reset': { const g = this.findGraphic(a.id); g.data.scoreA = 0; g.data.scoreB = 0; return done(); }
      case 'score.swap': {
        const g = this.findGraphic(a.id); const d = g.data;
        [d.teamA, d.teamB] = [d.teamB, d.teamA]; [d.scoreA, d.scoreB] = [d.scoreB, d.scoreA];
        [d.colorA, d.colorB] = [d.colorB, d.colorA]; [d.logoA, d.logoB] = [d.logoB, d.logoA];
        return done();
      }

      /* Schritt-Grafiken (Lyrics, Jetzt/Gleich/Danach) */
      case 'step': case 'step.goto': {
        const g = this.findGraphic(a.id);
        const n = this._stepCount(g);
        let i = cmd === 'step.goto' ? Number(a.index) || 0 : (Number(g.data.index) || 0) + (Number(a.delta) || 1);
        i = Math.max(0, Math.min(Math.max(0, n - 1), i));
        g.data.index = i;
        return done({ index: i, count: n });
      }

      /* Variablen & Listen */
      case 'var.set': {
        const name = cleanVarName(a.name);
        if (a.value === null) delete p.variables.text[name]; else p.variables.text[name] = String(a.value === undefined ? '' : a.value);
        return done();
      }
      case 'var.rename': {
        const from = cleanVarName(a.from), to = cleanVarName(a.to);
        for (const bucket of ['text', 'lists']) if (from in p.variables[bucket]) { p.variables[bucket][to] = p.variables[bucket][from]; delete p.variables[bucket][from]; }
        return done();
      }
      case 'list.set': {
        const name = cleanVarName(a.name);
        if (a.items === null) { delete p.variables.lists[name]; return done(); }
        const items = Array.isArray(a.items) ? a.items.map(String) : String(a.items || '').split('\n').filter((s) => s !== '');
        const old = p.variables.lists[name];
        p.variables.lists[name] = { items, index: Math.min(old ? old.index : 0, Math.max(0, items.length - 1)) };
        return done();
      }
      case 'list.select': {
        const l = p.variables.lists[cleanVarName(a.name)];
        if (!l) throw new HttpError(404, 'Liste nicht gefunden');
        const n = l.items.length;
        let i = a.index !== undefined ? Number(a.index) : (l.index || 0) + (Number(a.delta) || 1);
        if (a.wrap !== false && n) i = ((i % n) + n) % n; else i = Math.max(0, Math.min(n - 1, i));
        l.index = i;
        return done({ index: i, value: l.items[i] });
      }

      /* Theme & Einstellungen */
      case 'theme.update': {
        Object.assign(p.theme, a.theme || {});
        return done();
      }
      case 'theme.preset': {
        const pr = Types.THEME_PRESETS[a.preset];
        if (!pr) throw new HttpError(404, 'Preset unbekannt');
        Object.assign(p.theme, JSON.parse(JSON.stringify(pr)), { preset: a.preset });
        return done();
      }
      case 'settings.update': { Object.assign(p.settings, pick(a.settings || {}, ['takeMode', 'resolution', 'safeAreaGuide'])); return done(); }
      case 'output.add': {
        const ids = p.settings.outputs.map((o) => Number(o.id)).filter((n) => !isNaN(n));
        const id = String((ids.length ? Math.max(...ids) : 0) + 1);
        p.settings.outputs.push({ id, name: a.name || `Ausgang ${id}`, background: 'transparent', audio: false });
        return done({ id });
      }
      case 'output.update': {
        const o = p.settings.outputs.find((x) => x.id === String(a.id));
        if (!o) throw new HttpError(404, 'Ausgang nicht gefunden');
        Object.assign(o, pick(a, ['name', 'background', 'audio', 'safeArea']));
        return done();
      }
      case 'output.remove': {
        if (String(a.id) === '1') throw new HttpError(400, 'Ausgang 1 kann nicht entfernt werden');
        p.settings.outputs = p.settings.outputs.filter((x) => x.id !== String(a.id));
        for (const g of p.graphics) g.outputs = g.outputs.filter((o) => o !== String(a.id));
        return done();
      }

      /* Projekte */
      case 'project.list': return { current: p.id, projects: this.store.listProjects() };
      case 'project.create': {
        const np = this.store.createProject(a.name || 'Neues Projekt', a.duplicate ? p : null);
        if (a.switchTo !== false) this._switch(np.id);
        return { id: np.id };
      }
      case 'project.switch': this._switch(a.id); return true;
      case 'project.rename': p.name = String(a.name || p.name).slice(0, 120); return done();
      case 'project.delete': this.store.deleteProject(a.id); this._broadcastControl({ t: 'projects' }); return true;

      /* Google Sheets */
      case 'sheet.add': {
        const s = { id: uid(6), name: cleanVarName(a.name || 'tabelle' + (p.sheets.length + 1)), url: a.url || '', interval: Number(a.interval) || 10, enabled: true, cache: null, error: '', updated: 0 };
        p.sheets.push(s); this._restartSheets(); return done({ id: s.id });
      }
      case 'sheet.update': {
        const s = p.sheets.find((x) => x.id === a.id);
        if (!s) throw new HttpError(404, 'Tabelle nicht gefunden');
        Object.assign(s, pick(a, ['url', 'interval', 'enabled']));
        if (a.name) s.name = cleanVarName(a.name);
        this._restartSheets(); return done();
      }
      case 'sheet.remove': p.sheets = p.sheets.filter((x) => x.id !== a.id); this._restartSheets(); return done();
      case 'sheet.refresh': for (const s of p.sheets) if (!a.id || s.id === a.id) this._pollSheet(s); return true;

      /* Publikum: Fragen-Grafik (einzelne Frage manuell einblenden) */
      case 'qa.show': {
        const q = p.questions.find((x) => x.id === a.id);
        if (!q) throw new HttpError(404, 'Frage nicht gefunden');
        let g = a.graphicId ? this.findGraphic(a.graphicId) : p.graphics.find((x) => x.type === 'qa');
        if (!g) { g = this.store.makeGraphic('qa', 'Publikumsfrage'); p.graphics.push(g); }
        g.data.author = q.author; g.data.question = q.text;
        for (const other of p.questions) if (other !== q) other.active = false;
        q.status = 'live'; q.active = true; q.resolved = false;
        this._audDirty = true;
        if (a.live !== false) this._setLive(g, true); else g.preview = true;
        return done({ graphicId: g.id });
      }

      /* Chat */
      case 'chat.connect': this.twitch.connect(a.channel); return true;
      case 'chat.disconnect': this.twitch.disconnect(); return true;
      case 'chat.show': {
        const m = this.chatLog.find((x) => x.id === a.msgId) || a.msg;
        if (!m) throw new HttpError(404, 'Nachricht nicht gefunden');
        let g = a.graphicId ? this.findGraphic(a.graphicId) : p.graphics.find((x) => x.type === 'social');
        if (!g) { g = this.store.makeGraphic('social', 'Chat-Nachricht'); p.graphics.push(g); }
        Object.assign(g.data, { platform: m.platform || 'twitch', author: m.author, message: m.text, color: m.color || '' });
        if (a.live !== false) this._setLive(g, true); else g.preview = true;
        return done({ graphicId: g.id });
      }

      default: {
        if (cmd.startsWith('qa.') || cmd.startsWith('poll.')) {
          let r;
          try { r = this.audience.exec(cmd, a); } catch (e) { throw new HttpError(e.code || 400, e.message); }
          if (r !== undefined) { this._audDirty = true; return cmd === 'qa.test' ? r : done(r); }
        }
        throw new HttpError(400, 'Unbekannter Befehl: ' + cmd);
      }
    }
  }

  _switch(id) {
    for (const t of this.autoHideTimers.values()) clearTimeout(t);
    this.autoHideTimers.clear();
    this.store.switchProject(id);
    this.audience.reset();
    this._audDirty = true;
    this._restartSheets();
    this._restoreAutoHide();
    this.changed();
    this._broadcastControl({ t: 'projects' });
  }

  /* ---------- Sheets-Abfrage ---------- */
  _restartSheets() {
    for (const t of this.sheetTimers.values()) clearInterval(t);
    this.sheetTimers.clear();
    for (const s of this.project.sheets) {
      if (!s.enabled || !s.url) continue;
      this._pollSheet(s);
      this.sheetTimers.set(s.id, setInterval(() => this._pollSheet(s), Math.max(2, Number(s.interval) || 10) * 1000));
    }
  }

  async _pollSheet(s) {
    try {
      const vals = await fetchSheet(s);
      const prev = JSON.stringify(s.cache);
      this.sheetValues[s.id] = vals;
      s.error = '';
      s.updated = Date.now();
      s.cache = { cells: vals.cells, keys: vals.keys, columns: vals.columns, rows: vals.rows };
      if (prev !== JSON.stringify(s.cache)) this.changed();
      else this._broadcastControl({ t: 'sheetOk', id: s.id, updated: s.updated });
    } catch (e) {
      if (s.error !== e.message) { s.error = e.message; this.changed(); }
    }
  }

  /* ---------- HTTP ---------- */
  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { this._cors(res); res.writeHead(204); res.end(); return; }

    if (p === '/' ) { res.writeHead(302, { Location: '/control' }); res.end(); return; }
    if (p === '/control' || p === '/control/') {
      if (!this._pinOk(req, url)) return this._file(res, path.join(PUBLIC, 'control', 'login.html'));
      if (url.searchParams.get('pin')) res.setHeader('Set-Cookie', `cuepin=${encodeURIComponent(url.searchParams.get('pin'))}; Path=/; SameSite=Lax`);
      return this._file(res, path.join(PUBLIC, 'control', 'index.html'));
    }
    if (/^\/output\/[\w-]+\/?$/.test(p)) return this._file(res, path.join(PUBLIC, 'output', 'index.html'));
    if (p === '/audience' || p === '/audience/') return this._file(res, path.join(PUBLIC, 'audience', 'index.html'));
    if (p.startsWith('/media/')) return this._media(req, res, p.slice(7));
    if (p.startsWith('/api/')) return this._api(req, res, url, p.slice(5));
    if (/^\/(shared|output|control|audience)\/[\w.\-/]+$/.test(p) && !p.includes('..')) {
      const f = path.join(PUBLIC, p);
      if (f.startsWith(PUBLIC) && fs.existsSync(f) && fs.statSync(f).isFile()) return this._file(res, f);
    }
    throw new HttpError(404, 'Nicht gefunden');
  }

  _cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cue-Pin');
  }

  _file(res, f) {
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  }

  _media(req, res, name) {
    const f = this.store.mediaPath(name);
    if (!fs.existsSync(f)) throw new HttpError(404, 'Datei nicht gefunden');
    const st = fs.statSync(f);
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (range) {
      let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      end = Math.min(end, st.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(f, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
    fs.createReadStream(f).pipe(res);
  }

  _json(res, obj, code = 200) {
    this._cors(res);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  _error(res, e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    if (code === 500) console.error('[CueGFX]', e);
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    this._json(res, { ok: false, error: e.message }, code);
  }

  _readBody(req, limit = 50 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Zu groß')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async _args(req, url) {
    const args = {};
    for (const [k, v] of url.searchParams) if (k !== 'pin') args[k] = v;
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await this._readBody(req, 5 * 1024 * 1024);
      if (body.length) {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json') || /^\s*[{[]/.test(body.toString('utf8', 0, 20))) {
          try { Object.assign(args, JSON.parse(body.toString('utf8'))); } catch (_) { throw new HttpError(400, 'Ungültiges JSON'); }
        } else if (ct.includes('urlencoded')) {
          for (const [k, v] of new URLSearchParams(body.toString('utf8'))) args[k] = v;
        } else args.value = body.toString('utf8');
      }
    }
    return args;
  }

  async _api(req, res, url, route) {
    const open = route === 'qr.svg' || route === 'fonts.css' || route === 'info' || route === 'theme.css';
    if (!open && !this._pinOk(req, url)) throw new HttpError(401, 'PIN erforderlich');
    const parts = route.split('/').filter(Boolean);
    const m = req.method;

    if (route === 'qr.svg') {
      const svg = QR.toSvg(url.searchParams.get('text') || '', { fg: url.searchParams.get('fg') || '#000', bg: url.searchParams.get('bg') || '#fff', border: Number(url.searchParams.get('border') || 4) });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      res.end(svg); return;
    }
    if (route === 'fonts.css') {
      const css = this.store.listMedia().filter((f) => f.kind === 'font').map((f) => {
        const fam = f.name.replace(/\.[^.]+$/, '');
        return `@font-face{font-family:"${fam.replace(/"/g, '')}";src:url("/media/${encodeURIComponent(f.name)}");font-display:block;}`;
      }).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(css); return;
    }
    if (route === 'info') return this._json(res, { app: 'CueGFX', version: VERSION, port: this.port, lan: this.lanUrls(), pin: !!this.store.config.accessPin, desktop: !!this.hooks.desktop });

    if (route === 'state') return this._json(res, { project: this.project, vars: this.variables(), serverTime: Date.now() });
    if (route === 'cmd' && m === 'POST') {
      const a = await this._args(req, url);
      return this._json(res, { ok: true, result: this.exec(a.cmd, a.args || {}) });
    }

    /* Grafiken – GET und POST, damit Bitfocus Companion & Stream Deck einfach per URL steuern können */
    if (parts[0] === 'graphics') {
      if (parts.length === 1) return this._json(res, this.project.graphics.map((g) => ({ id: g.id, name: g.name, type: g.type, live: g.live, preview: g.preview, outputs: g.outputs })));
      const g = this.findGraphic(parts[1]);
      if (parts.length === 2) return this._json(res, g);
      const a = await this._args(req, url);
      const action = parts[2];
      const map = {
        show: 'graphic.show', hide: 'graphic.hide', toggle: 'graphic.toggle', preview: 'graphic.preview',
        'timer-start': 'timer.start', 'timer-pause': 'timer.pause', 'timer-toggle': 'timer.toggle', 'timer-reset': 'timer.reset',
        'timer-set': 'timer.set', 'timer-add': 'timer.add', score: 'score.add', 'score-set': 'score.set', 'score-reset': 'score.reset',
        next: 'step', prev: 'step', goto: 'step.goto', duplicate: 'graphic.duplicate'
      };
      if (action === 'update') {
        const data = Object.assign({}, a.data || {});
        // Alle Parameter sind Grafik-Felder (auch "name" der Bauchbinde). Umbenennen der Grafik selbst über "rename".
        for (const [k, v] of Object.entries(a)) if (!['data', 'rename', 'outputs', 'value'].includes(k)) data[k] = v;
        const outs = typeof a.outputs === 'string' ? a.outputs.split(',').map((x) => x.trim()).filter(Boolean) : a.outputs;
        return this._json(res, { ok: true, result: this.exec('graphic.update', { id: g.id, data, name: a.rename, outputs: outs }) });
      }
      if (action === 'prev') a.delta = -(Number(a.delta) || 1);
      if (action === 'preview' && a.on !== undefined) a.on = a.on === 'true' || a.on === '1' || a.on === true;
      if (!map[action]) throw new HttpError(404, 'Unbekannte Aktion: ' + action);
      return this._json(res, { ok: true, result: this.exec(map[action], Object.assign(a, { id: g.id })) });
    }
    if (route === 'take') return this._json(res, { ok: true, result: this.exec('take') });
    if (route === 'hide-all') { const a = await this._args(req, url); return this._json(res, { ok: true, result: this.exec('hideAll', a) }); }
    if (route === 'clear-preview') return this._json(res, { ok: true, result: this.exec('preview.clear') });
    if (parts[0] === 'variables') {
      if (parts.length === 1) return this._json(res, this.variables());
      const a = await this._args(req, url);
      if (m === 'GET' && a.value === undefined) return this._json(res, { name: parts[1], value: this.variables()[parts[1]] });
      return this._json(res, { ok: true, result: this.exec('var.set', { name: parts[1], value: a.value }) });
    }
    if (parts[0] === 'lists' && parts[1]) {
      const a = await this._args(req, url);
      const op = parts[2] || 'get';
      if (op === 'get') return this._json(res, this.project.variables.lists[parts[1]] || null);
      if (op === 'next') return this._json(res, { ok: true, result: this.exec('list.select', { name: parts[1], delta: 1 }) });
      if (op === 'prev') return this._json(res, { ok: true, result: this.exec('list.select', { name: parts[1], delta: -1 }) });
      if (op === 'select') return this._json(res, { ok: true, result: this.exec('list.select', { name: parts[1], index: Number(a.index) }) });
      if (op === 'set') return this._json(res, { ok: true, result: this.exec('list.set', { name: parts[1], items: a.items || a.value }) });
    }
    if (parts[0] === 'projects') {
      if (parts.length === 1) return this._json(res, this.exec('project.list'));
      if (parts[2] === 'switch') return this._json(res, { ok: true, result: this.exec('project.switch', { id: parts[1] }) });
    }
    if (route === 'sheets/refresh') return this._json(res, { ok: true, result: this.exec('sheet.refresh') });

    /* Medien */
    if (parts[0] === 'media') {
      if (parts.length === 1 && m === 'GET') return this._json(res, this.store.listMedia());
      if (parts.length === 1 && (m === 'PUT' || m === 'POST')) return this._upload(req, res, url);
      if (parts.length === 2 && m === 'DELETE') {
        fs.rmSync(this.store.mediaPath(parts[1]), { force: true });
        this._broadcastControl({ t: 'media' });
        return this._json(res, { ok: true });
      }
    }

    /* Export / Import */
    if (route === 'export' && m === 'GET') return this._export(res, url);
    if (route === 'import' && m === 'POST') return this._import(req, res, url);

    /* Zugriff */
    if (route === 'access' && m === 'POST') {
      const a = await this._args(req, url);
      this.store.config.accessPin = String(a.pin || '').slice(0, 32);
      this.store.saveConfig();
      return this._json(res, { ok: true });
    }

    /* Hardware (Desktop-App) */
    if (parts[0] === 'decklink') {
      const dl = this.hooks.decklink;
      if (!dl) return this._json(res, { available: false, reason: 'DeckLink-Ausgabe ist nur in der Desktop-App verfügbar' });
      if (m === 'GET' && parts.length === 1) return this._json(res, dl.info());
      const a = await this._args(req, url);
      if (parts[1] === 'rescan') { await dl.rescan(); return this._json(res, dl.info()); }
      if (parts[1] === 'config') { await dl.configure(a.outputs || []); this.store.config.decklinkOutputs = dl.getConfig(); this.store.saveConfig(); this._pushHardware(); return this._json(res, dl.info()); }
    }
    if (parts[0] === 'ndi') {
      const nd = this.hooks.ndi;
      if (!nd) return this._json(res, { available: false, reason: 'NDI-Ausgabe ist nur in der Desktop-App verfügbar' });
      if (m === 'GET' && parts.length === 1) return this._json(res, nd.info());
      const a = await this._args(req, url);
      if (parts[1] === 'config') { nd.configure(a.outputs || []); this.store.config.ndiOutputs = nd.getConfig(); this.store.saveConfig(); this._pushHardware(); return this._json(res, nd.info()); }
      if (parts[1] === 'library') { nd.setLibrary(a.path || ''); this.store.config.ndiLibPath = nd.libPath; this.store.saveConfig(); this._pushHardware(); return this._json(res, nd.info()); }
      if (parts[1] === 'pick') {
        const picked = await nd.pickLibrary(this.hooks.mainWindow && this.hooks.mainWindow());
        if (picked) { this.store.config.ndiLibPath = nd.libPath; this.store.saveConfig(); this._pushHardware(); }
        return this._json(res, Object.assign({ picked }, nd.info()));
      }
    }
    if (parts[0] === 'displays') {
      const ds = this.hooks.displays;
      if (!ds) return this._json(res, { available: false });
      if (m === 'GET' && parts.length === 1) return this._json(res, ds.info());
      const a = await this._args(req, url);
      if (parts[1] === 'config') { ds.configure(a.outputs || []); this.store.config.displayOutputs = ds.getConfig(); this.store.saveConfig(); this._pushHardware(); return this._json(res, ds.info()); }
      if (parts[1] === 'identify') { ds.identify(); return this._json(res, { ok: true }); }
    }
    if (route === 'open-window' && this.hooks.openWindow) { const a = await this._args(req, url); this.hooks.openWindow(a.path || '/output/1'); return this._json(res, { ok: true }); }

    throw new HttpError(404, 'Unbekannter API-Pfad: ' + route);
  }

  _upload(req, res, url) {
    const name = this.store.uniqueMediaName(url.searchParams.get('name') || 'upload');
    const dest = path.join(this.store.mediaDir, name);
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let size = 0;
    req.on('data', (c) => { size += c.length; });
    req.pipe(out);
    out.on('finish', () => {
      fs.renameSync(tmp, dest);
      this._broadcastControl({ t: 'media' });
      this._json(res, { ok: true, name, size, kind: mediaKind(name) });
    });
    out.on('error', (e) => { fs.rmSync(tmp, { force: true }); this._error(res, e); });
    req.on('error', () => { out.destroy(); fs.rmSync(tmp, { force: true }); });
  }

  _referencedMedia(project) {
    // Medien werden als Dateiname (z. B. "logo.png") oder als /media/…-Pfad (z. B. im eigenen CSS) referenziert
    const all = new Map(this.store.listMedia().map((m) => [m.name, m]));
    const names = new Set();
    const visit = (v) => {
      if (typeof v === 'string') {
        if (all.has(v)) names.add(v);
        const re = /\/media\/([^"'\\)\s?#]+)/g;
        let mm;
        while ((mm = re.exec(v))) { try { const n = decodeURIComponent(mm[1]); if (all.has(n)) names.add(n); } catch (_) {} }
      } else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(project);
    // Schriften gehören zum Theme und werden immer mitgenommen
    for (const m of all.values()) if (m.kind === 'font') names.add(m.name);
    return [...names];
  }

  _export(res, url) {
    const project = JSON.parse(JSON.stringify(this.project));
    for (const g of project.graphics) { g.live = false; g.preview = false; }
    const entries = [{ name: 'project.json', data: JSON.stringify(project, null, 2) }];
    if (url.searchParams.get('media') !== '0') {
      for (const n of this._referencedMedia(project)) entries.push({ name: 'media/' + n, data: fs.readFileSync(this.store.mediaPath(n)), compress: /\.(svg|json|txt|ttf|otf)$/i.test(n) });
    }
    const zip = createZip(entries);
    const fname = (project.name || 'projekt').replace(/[^\w\-äöüÄÖÜß ]/g, '_') + '.cuegfx.zip';
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fname)}` });
    res.end(zip);
  }

  async _import(req, res, url) {
    const body = await this._readBody(req, 2 * 1024 * 1024 * 1024);
    let project;
    let mediaCount = 0;
    if (body[0] === 0x50 && body[1] === 0x4b) {
      const files = readZip(body);
      const pj = files.find((f) => f.name === 'project.json');
      if (!pj) throw new HttpError(400, 'project.json fehlt im Archiv');
      project = JSON.parse(pj.data.toString('utf8'));
      for (const f of files) {
        if (!f.name.startsWith('media/')) continue;
        const n = this.store.safeMediaName(f.name.slice(6));
        const dest = this.store.mediaPath(n);
        if (!fs.existsSync(dest)) { fs.writeFileSync(dest, f.data); mediaCount++; }
      }
    } else {
      try { project = JSON.parse(body.toString('utf8')); } catch (_) { throw new HttpError(400, 'Datei ist weder ZIP noch JSON'); }
    }
    if (!project || !Array.isArray(project.graphics)) throw new HttpError(400, 'Kein CueGFX-Projekt');
    const np = this.store.createProject(url.searchParams.get('name') || project.name, project);
    if (url.searchParams.get('switch') !== '0') this._switch(np.id);
    this._broadcastControl({ t: 'media' });
    return this._json(res, { ok: true, id: np.id, media: mediaCount });
  }
}

/* ---------- Hilfsfunktionen ---------- */
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
function cleanVarName(n) { return String(n || '').trim().replace(/[{}\s]+/g, '_').slice(0, 60) || 'var'; }

function parseTime(v) {
  if (typeof v === 'number') return Math.max(0, v);
  const s = String(v || '0').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function coerce(type, key, v) {
  const f = Types.allFields(type).find((x) => x.key === key);
  if (!f) return v;
  if (f.type === 'number') { const n = Number(v); return isNaN(n) ? 0 : n; }
  if (f.type === 'toggle') return v === true || v === 'true' || v === '1' || v === 1 || v === 'on';
  if (f.type === 'list' || f.type === 'builder') {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return []; } }
    return Array.isArray(v) ? v : [];
  }
  if (f.type === 'timer') return typeof v === 'object' && v ? v : Types.defaultTimer(parseTime(v));
  return v === null || v === undefined ? '' : String(v);
}

module.exports = { CueServer, parseTime };
