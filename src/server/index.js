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
const { ChatHub } = require('./chat/hub');
const { SystemFonts } = require('./sysfonts');
const { createAudience } = require('./audience');
const Types = require('../../public/shared/graphic-types.js');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const PKG = require('../../package.json');
const VERSION = PKG.version;
const BUILD = PKG.buildInfo || null; // nur in CI-Builds gesetzt (scripts/set-version.js)

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
    this.instanceId = require('crypto').randomBytes(8).toString('hex');
    this.sysFonts = new SystemFonts(opts.fontDirs ? { dirs: opts.fontDirs } : undefined);
    this.chat = new ChatHub(this.store, opts.chatOpts);
    this.chat.on('message', (m) => {
      this.chatLog.push(m);
      if (this.chatLog.length > 500) this.chatLog.shift();
      this._broadcastControl({ t: 'chat', msg: m });
      this.emit('chat', m);
    });
    this.chat.on('change', () => {
      clearTimeout(this._chatTimer);
      this._chatTimer = setTimeout(() => this._broadcastControl(this._chatSourcesPayload()), 150);
    });
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
        for (const g of this.project.graphics) {
          if (g.type === 'wheel' && g.data.wheel && g.data.wheel.spinning) this._wheelSchedule(g);
          if (g.type === 'slot' && g.data.slot && g.data.slot.spinning) this._spinSchedule(g, 'slot', 'slot.finish');
        }
        this.hwTimer = setInterval(() => this._pushHardware(), 1000);
        this.chat.init();
        this._startPublic();
        this.sysFonts.scan().then((n) => {
          console.log(`[CueGFX] ${n} installierte Schriftfamilien gefunden (${this.sysFonts.ms} ms)`);
          this._broadcastControl({ t: 'sysFonts', families: this.sysFonts.names() });
        }).catch((e) => { this.sysFonts.error = e.message; });
        resolve(this.port);
      });
    });
  }

  async stop() {
    clearInterval(this.hwTimer);
    for (const t of this.sheetTimers.values()) clearInterval(t);
    for (const t of this.autoHideTimers.values()) clearTimeout(t);
    for (const t of (this.wheelTimers || new Map()).values()) clearTimeout(t);
    clearTimeout(this._chatTimer);
    this.chat.stopAll();
    this.store.saveProjectNow();
    await this._stopPublic();
    if (this.ws) this.ws.close();
    if (this.http) await new Promise((r) => this.http.close(() => r()));
  }

  /* ---------- Öffentlicher Zugang nur für die Publikumsseite (z. B. hinter Nginx Proxy Manager) ---------- */
  async _stopPublic() {
    if (this.pubWs) { try { this.pubWs.close(); } catch (_) {} this.pubWs = null; }
    if (this.pubHttp) { const h = this.pubHttp; this.pubHttp = null; await new Promise((r) => { h.close(() => r()); setTimeout(r, 500); }); }
  }
  async _startPublic() {
    await this._stopPublic();
    const port = Number(this.store.config.audiencePort) || 0;
    this.pubStatus = port ? 'startet…' : 'aus';
    if (!port) return;
    const srv = http.createServer((req, res) => this._handlePublic(req, res).catch((e) => this._error(res, e)));
    const ws = new WsServer(srv, { path: '/ws', verify: (req, url) => url.searchParams.get('role') === 'audience' });
    ws.on('connection', (c) => this._wsConnection(c));
    await new Promise((resolve) => {
      srv.once('error', (e) => { this.pubStatus = e.code === 'EADDRINUSE' ? `Port ${port} ist belegt` : 'Fehler: ' + e.message; this.pubHttp = null; this.pubWs = null; resolve(); });
      srv.listen(port, this.host, () => { this.pubHttp = srv; this.pubWs = ws; this.pubStatus = 'läuft'; resolve(); });
    });
  }

  async _handlePublic(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-CueGFX-Instance', this.instanceId);
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (p === '/' || p === '/audience' || p === '/audience/' || p === '/index.html') return this._file(res, path.join(PUBLIC, 'audience', 'index.html'));
    if (p === '/shared/client.js') return this._file(res, path.join(PUBLIC, 'shared', 'client.js'));
    if (p === '/api/audience.css') return this._audienceCss(res);
    if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    const allow = this._audienceAssets();
    if (p.startsWith('/media/') && allow.media.has(p.slice(7))) return this._media(req, res, p.slice(7));
    if (p === '/favicon.ico' && allow.logo) return this._media(req, res, allow.logo);
    const sf = p.match(/^\/api\/sysfont\/(\d+)/);
    if (sf && allow.sysfont.has(Number(sf[1]))) return this._api(req, res, url, p.slice(5));
    throw new HttpError(404, 'Nicht gefunden');
  }

  /* Prüft, ob die Publikumsseite unter der eigenen Domain erreichbar ist und funktioniert */
  async _testAudienceUrl(urlStr) {
    const steps = [];
    const add = (ok, label, detail, warn) => steps.push({ ok, warn: !!warn, label, detail });
    const done = () => ({ ok: steps.every((x) => x.ok || x.warn), steps, url: urlStr });
    let u;
    try {
      let raw = String(urlStr || '').trim();
      if (!raw) { add(false, 'Adresse', 'Keine öffentliche Adresse eingetragen'); return done(); }
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
      u = new URL(raw);
    } catch (_) { add(false, 'Adresse', 'Ungültige Adresse'); return done(); }
    const base = u.origin + (u.pathname.endsWith('/') ? u.pathname : u.pathname + '/');
    // 1. DNS
    try {
      const r = await require('dns').promises.lookup(u.hostname);
      add(true, 'DNS', `${u.hostname} → ${r.address}`);
    } catch (e) { add(false, 'DNS', `${u.hostname} lässt sich nicht auflösen (${e.code || e.message}) – DNS-Eintrag prüfen`); return done(); }
    // 2. Seite laden
    const explain = (e) => {
      const c = (e.cause && (e.cause.code || e.cause.message)) || e.name || e.message;
      if (/TimeoutError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(c)) return 'Zeitüberschreitung – Port 80/443 am Router freigegeben? Proxy erreichbar?';
      if (/ECONNREFUSED/.test(c)) return 'Verbindung abgelehnt – läuft der Proxy, ist der Port offen?';
      if (/CERT|SSL|TLS|self.signed|ALTNAME|UNABLE_TO_VERIFY/i.test(c)) return `HTTPS-Zertifikat ungültig (${c}) – im NPM unter „SSL“ ein Let’s-Encrypt-Zertifikat für diese Domain anfordern`;
      if (/ENOTFOUND|EAI_AGAIN/.test(c)) return 'Domain nicht gefunden';
      return c;
    };
    let res, html = '', t0 = Date.now();
    try {
      res = await fetch(base, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'cache-control': 'no-cache', 'user-agent': 'CueGFX-Selbsttest' } });
      html = await res.text();
    } catch (e) { add(false, 'Verbindung', explain(e)); return done(); }
    const ms = Date.now() - t0;
    if (!res.ok) {
      const hint = res.status === 502 || res.status === 504 ? ' – der Proxy erreicht CueGFX nicht: Forward-IP/Port im NPM und Firewall dieses Rechners prüfen' : res.status === 404 ? ' – Proxy-Host/Pfad prüfen' : '';
      add(false, 'Seite laden', `HTTP ${res.status}${hint}`);
      return done();
    }
    // Umleitungen (z. B. NPM „Force SSL“ http → https) beachten: alle weiteren Tests gegen die Zieladresse
    let fin = u;
    try { if (res.url) fin = new URL(res.url); } catch (_) {}
    if (fin.href !== new URL(base).href) {
      const toHttps = u.protocol === 'http:' && fin.protocol === 'https:';
      add(!toHttps, 'Umleitung', toHttps
        ? `${u.origin} leitet auf ${fin.origin} um – Adresse besser direkt mit https:// eintragen (QR-Codes führen dann ohne Umweg zur Seite)`
        : `Weitergeleitet auf ${fin.href}`, true);
    }
    add(true, 'Seite laden', `HTTP ${res.status} in ${ms} ms${fin.protocol === 'https:' ? ' · HTTPS-Zertifikat gültig' : ''}`);
    // 3. Eingabemaske dieser CueGFX-Installation?
    const isAudience = /id="ask"/.test(html) && /id="q"/.test(html) && /\/shared\/client\.js/.test(html);
    const inst = res.headers.get('x-cuegfx-instance');
    if (!isAudience) { add(false, 'Eingabemaske', 'Unter der Adresse antwortet eine andere Seite (z. B. Standardseite des Proxys) – Forward-Port auf den öffentlichen Port von CueGFX stellen'); return done(); }
    if (inst && inst !== this.instanceId) add(false, 'Eingabemaske', 'Publikumsseite gefunden, aber von einer anderen CueGFX-Installation');
    else if (!inst) add(true, 'Eingabemaske', 'Fragefeld gefunden (über den Steuerungs-Port statt den öffentlichen Port – besser auf den öffentlichen Port weiterleiten)', true);
    else add(true, 'Eingabemaske', 'Publikumsseite mit Fragefeld dieser CueGFX-Installation geladen');
    // 4. Gestaltung erreichbar
    try {
      const c = await fetch(fin.origin + '/api/audience.css', { signal: AbortSignal.timeout(8000) });
      add(c.ok, 'Gestaltung', c.ok ? 'Design-Datei geladen' : `Design-Datei: HTTP ${c.status}`);
    } catch (e) { add(false, 'Gestaltung', explain(e)); }
    // 5. WebSocket (Live-Updates, Fragen senden)
    const wsUrl = (fin.protocol === 'https:' ? 'wss://' : 'ws://') + fin.host + '/ws?role=audience&voter=cuegfx-selbsttest';
    const wsOk = await new Promise((resolve) => {
      if (typeof WebSocket !== 'function') return resolve('WebSocket-Test in dieser Version nicht möglich');
      let w; const t = setTimeout(() => { try { w.close(); } catch (_) {} resolve('Keine Antwort'); }, 8000);
      try { w = new WebSocket(wsUrl); } catch (e) { clearTimeout(t); return resolve(e.message); }
      w.onmessage = (ev) => { try { if (JSON.parse(ev.data).t === 'audience') { clearTimeout(t); w.close(); resolve(true); } } catch (_) {} };
      w.onerror = (ev) => { clearTimeout(t); resolve((ev && ev.message) || 'Verbindung abgelehnt'); };
      w.onclose = (ev) => { clearTimeout(t); resolve(`Verbindung geschlossen${ev && ev.code ? ' (Code ' + ev.code + ')' : ''}`); };
    });
    if (wsOk === true) add(true, 'Live-Verbindung', 'WebSocket funktioniert – Fragen und Likes kommen live an');
    else add(false, 'Live-Verbindung', `WebSocket fehlgeschlagen (${wsOk}) – im NPM beim Proxy-Host „Websockets Support“ einschalten`);
    // 6. Weiterleitung http → https (nur Hinweis)
    if (fin.protocol === 'https:') {
      try {
        const r = await fetch('http://' + fin.host + '/', { redirect: 'manual', signal: AbortSignal.timeout(6000) });
        const loc = r.headers.get('location') || '';
        if (r.status >= 300 && r.status < 400 && loc.startsWith('https:')) add(true, 'HTTPS erzwingen', 'http:// wird auf https:// umgeleitet');
        else add(false, 'HTTPS erzwingen', 'http:// wird nicht auf https:// umgeleitet – im NPM unter „SSL“ „Force SSL“ einschalten (optional)', true);
      } catch (_) { add(false, 'HTTPS erzwingen', 'http:// nicht erreichbar (Port 80 zu) – für Let’s Encrypt-Verlängerung meist nötig', true); }
    }
    return done();
  }

  /* Schriftfamilie aus einem CSS-Wert wie '"Avenir Next", sans-serif' */
  _familyOf(v) { const m = String(v || '').match(/^\s*["']?([^"',]+)["']?/); return m ? m[1].trim() : ''; }

  /* Welche Dateien die Publikumsseite laden darf (Logo, verwendete Schriften) */
  _audienceAssets() {
    const d = this.project.audienceDesign || {};
    const media = new Set(), sysfont = new Set();
    let logo = '';
    if (d.logo && !/^https?:/.test(d.logo)) { media.add(d.logo); logo = d.logo; }
    const fams = [d.font, d.headingFont].map((v) => this._familyOf(v)).filter(Boolean);
    const fonts = this.store.listMedia().filter((m) => m.kind === 'font');
    for (const fam of fams) {
      for (const m of fonts) if (m.name.replace(/\.[^.]+$/, '') === fam) media.add(m.name);
      const sys = this.sysFonts.families.get(fam);
      if (sys) for (const face of sys.faces) if (!face.collection) sysfont.add(face.file);
    }
    return { media, sysfont, logo, fams, fonts };
  }

  _audienceCss(res) {
    const d = this.project.audienceDesign || {};
    const A = this._audienceAssets();
    const out = [];
    for (const fam of A.fams) {
      for (const m of A.fonts) if (m.name.replace(/\.[^.]+$/, '') === fam) out.push(`@font-face{font-family:"${fam.replace(/"/g, '')}";src:url("/media/${encodeURIComponent(m.name)}");font-display:swap;}`);
      if (this.sysFonts.ready && this.sysFonts.families.has(fam)) out.push(this.sysFonts.css([fam]).replace(/font-display:block/g, 'font-display:swap'));
    }
    const light = d.mode === 'light';
    const v = {
      '--bg': d.bg || (light ? '#f4f5f7' : '#0f1115'),
      '--card': d.card || (light ? '#ffffff' : '#181b22'),
      '--fg': d.text || (light ? '#15181d' : '#eef1f5'),
      '--acc': d.primary || '#e11d48',
      '--acc2': d.accent || '#f59e0b',
      '--r': (Number(d.radius) >= 0 ? Number(d.radius) : 14) + 'px'
    };
    out.push(':root{' + Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';') +
      ';--card2:color-mix(in srgb,var(--card) 88%,var(--fg) 12%);--line:color-mix(in srgb,var(--card) 80%,var(--fg) 20%);' +
      '--fg2:color-mix(in srgb,var(--fg) 70%,var(--bg) 30%);--fg3:color-mix(in srgb,var(--fg) 50%,var(--bg) 50%);' + (light ? 'color-scheme:light;' : 'color-scheme:dark;') + '}');
    if (d.font) out.push(`:is(body,button,input,textarea,.tabs button,.seg button,button.primary,.opt,.like){font-family:${d.font};}`);
    if (d.headingFont) out.push(`h1,h2,.poll h2{font-family:${d.headingFont};}`);
    if (d.customCss) out.push('/* Eigenes CSS */\n' + String(d.customCss).replace(/<\/style/gi, ''));
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(out.join('\n'));
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
        c.send(JSON.stringify({ t: 'chatLog', log: this.chatLog }));
        c.send(JSON.stringify(this._chatSourcesPayload()));
        if (this._hwJson) c.send(this._hwJson);
      }
    }
  }

  _statePayload() {
    if (!this._lanCache || Date.now() - this._lanCache.t > 10000) this._lanCache = { t: Date.now(), urls: this.lanUrls() };
    return { t: 'state', serverTime: Date.now(), project: this.project, vars: this.variables(), info: { version: VERSION, build: BUILD, port: this.port, lan: this._lanCache.urls, audienceUrl: this._audienceUrl(), audiencePort: Number(this.store.config.audiencePort) || 0, audiencePublicUrl: this.store.config.audiencePublicUrl || '', audienceStatus: this.pubStatus || 'aus', audioOut: this.audioOut(), themeTemplates: this._themeTemplates(), frameTemplates: this.store.config.frameTemplates || [] } };
  }

  /* ---------- Q&A-Export (Markdown / HTML / PDF) ---------- */
  _qaData(scope) {
    const p = this.project;
    const qs = p.questions || [];
    const byLikes = (a, b) => (b.likes - a.likes) || (a.ts - b.ts);
    const groups = [];
    const add = (key, title, items) => { if (scope === 'all' || scope === key || (scope === 'open' && key === 'pending')) groups.push({ key, title, items: items.slice().sort(byLikes) }); };
    add('pending', 'Offen – wartet auf Freigabe', qs.filter((q) => q.status === 'pending'));
    add('open', 'Offen', qs.filter((q) => q.status === 'live' && !q.resolved));
    add('resolved', 'Gelöst', qs.filter((q) => q.status === 'live' && q.resolved));
    add('rejected', 'Abgelehnt', qs.filter((q) => q.status === 'rejected'));
    const counts = { open: qs.filter((q) => q.status === 'pending' || (q.status === 'live' && !q.resolved)).length, resolved: qs.filter((q) => q.status === 'live' && q.resolved).length, rejected: qs.filter((q) => q.status === 'rejected').length };
    const now = new Date();
    const fmt = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const scopeLabel = { all: 'Alle Fragen', open: 'Offene Fragen', resolved: 'Gelöste Fragen', rejected: 'Abgelehnte Fragen' }[scope];
    const safe = (p.name || 'Projekt').replace(/[^\wäöüÄÖÜß.-]+/g, '-').replace(/^-+|-+$/g, '');
    const fname = `Fragen-${safe}-${scope === 'all' ? 'alle' : { open: 'offen', resolved: 'geloest', rejected: 'abgelehnt' }[scope]}-${now.toISOString().slice(0, 10)}`;
    return { project: p.name, scopeLabel, groups, counts, total: groups.reduce((n, g) => n + g.items.length, 0), generated: fmt(now), fmt, fname };
  }

  _qaMarkdown(D) {
    const esc = (t) => String(t || '').replace(/\r/g, '').replace(/([\\`*_[\]<>#|])/g, '\\$1');
    const out = [`# ${esc(D.scopeLabel)} – ${esc(D.project)}`, '', `Export vom ${D.generated} · ${D.total} Frage${D.total === 1 ? '' : 'n'} (offen ${D.counts.open}, gelöst ${D.counts.resolved}, abgelehnt ${D.counts.rejected})`, ''];
    for (const g of D.groups) {
      out.push(`## ${g.title} (${g.items.length})`, '');
      if (!g.items.length) { out.push('_Keine Fragen._', ''); continue; }
      g.items.forEach((q, i) => {
        const meta = [q.author ? esc(q.author) : 'anonym', `▲ ${q.likes || 0}`, D.fmt(q.ts)];
        if (q.active) meta.push('★ aktiv');
        if ((q.flagged || []).length) meta.push(`Sperrwort: ${esc(q.flagged.join(', '))}`);
        out.push(`${i + 1}. ${esc(q.text).split('\n').join('  \n   ')}  `, `   — ${meta.join(' · ')}`, '');
      });
    }
    return out.join('\n');
  }

  _qaHtml(D, print) {
    const e = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const color = { pending: '#b7791f', open: '#2563eb', resolved: '#15803d', rejected: '#b91c1c' };
    const sec = D.groups.map((g) => `<section><h2 style="border-color:${color[g.key]}"><span>${e(g.title)}</span><small>${g.items.length}</small></h2>${g.items.length ? `<ol>${g.items.map((q) => `<li><div class="t">${e(q.text).replace(/\n/g, '<br>')}</div><div class="m"><b>${e(q.author || 'anonym')}</b><span>▲ ${q.likes || 0}</span><span>${e(D.fmt(q.ts))}</span>${q.active ? '<span class="tag">★ aktiv</span>' : ''}${(q.flagged || []).length ? `<span class="tag warn">Sperrwort: ${e(q.flagged.join(', '))}</span>` : ''}</div></li>`).join('')}</ol>` : '<p class="none">Keine Fragen.</p>'}</section>`).join('');
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(D.fname)}</title><style>
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; font: 11pt/1.45 -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif; color: #15181d; background: #fff; }
@media print { body { padding: 0; } .noprint { display: none !important; } }
header { border-bottom: 2px solid #15181d; padding-bottom: 10px; margin-bottom: 18px; }
h1 { margin: 0 0 4px; font-size: 20pt; } header p { margin: 0; color: #555; font-size: 10pt; }
.stats { display: flex; gap: 8px; margin-top: 10px; } .stats span { border: 1px solid #ddd; border-radius: 99px; padding: 2px 10px; font-size: 9pt; }
h2 { display: flex; justify-content: space-between; align-items: baseline; font-size: 13pt; margin: 22px 0 8px; padding-left: 10px; border-left: 5px solid; break-after: avoid; }
h2 small { color: #666; font-weight: 600; }
ol { margin: 0; padding-left: 24px; } li { margin: 0 0 10px; padding: 8px 10px; border: 1px solid #e3e5e8; border-radius: 6px; break-inside: avoid; }
li::marker { color: #888; font-weight: 700; } .t { font-weight: 600; white-space: normal; overflow-wrap: anywhere; }
.m { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 9pt; color: #555; } .m b { color: #15181d; }
.tag { background: #fff4d6; color: #7a5200; border-radius: 4px; padding: 0 6px; } .tag.warn { background: #fde2e2; color: #8a1c1c; }
.none { color: #888; font-style: italic; margin: 0 0 0 10px; }
.bar { position: sticky; top: 0; background: #f4f5f7; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; display: flex; gap: 10px; align-items: center; font-size: 10pt; }
.bar button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid #bbb; background: #fff; cursor: pointer; }
</style></head><body>${print ? '<div class="bar noprint"><button onclick="print()">🖨 Drucken / Als PDF sichern</button><span>Tipp: Im Druckdialog „Als PDF sichern“ wählen.</span></div>' : ''}
<header><h1>${e(D.scopeLabel)} – ${e(D.project)}</h1><p>Export vom ${e(D.generated)} · CueGFX</p><div class="stats"><span>${D.total} Frage${D.total === 1 ? '' : 'n'}</span><span>offen ${D.counts.open}</span><span>gelöst ${D.counts.resolved}</span><span>abgelehnt ${D.counts.rejected}</span></div></header>
${sec}${print ? '<script>setTimeout(() => print(), 400)</script>' : ''}</body></html>`;
  }

  async _qaExport(res, url, kind) {
    const scope = ['all', 'open', 'resolved', 'rejected'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all';
    const D = this._qaData(scope);
    const dispo = (ext) => `attachment; filename*=UTF-8''${encodeURIComponent(D.fname + '.' + ext)}`;
    if (kind === 'md') {
      const body = Buffer.from(this._qaMarkdown(D), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Length': body.length, 'Content-Disposition': dispo('md') });
      return res.end(body);
    }
    if (kind === 'html') {
      const body = Buffer.from(this._qaHtml(D, url.searchParams.get('print') === '1'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    // PDF: in der Desktop-App direkt erzeugen, sonst Druckansicht nutzen
    if (!this.hooks.printPdf) throw new HttpError(501, 'PDF-Erzeugung nur in der Desktop-App – bitte die Druckansicht nutzen');
    const pdf = await this.hooks.printPdf(this._qaHtml(D, false), `Fragen · ${D.project}`);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': dispo('pdf') });
    res.end(pdf);
  }

  _themeTemplates() {
    return (this.store.config.themeTemplates || []).map((t) => ({ id: t.id, name: t.name, primary: t.theme.primary, secondary: t.theme.secondary, accent: t.theme.accent, font: t.theme.headingFont || t.theme.font }));
  }

  audioOut() { return Object.assign({ enabled: true, output: '1', deviceId: '', label: '' }, this.store.config.audioOut || {}, { app: !!this.hooks.desktop }); }

  /* Adresse für QR-Codes & {{audience_url}}: eigene Domain, sonst öffentlicher Port im LAN, sonst Steuerungs-Port */
  _audienceUrl() {
    const c = this.store.config;
    if (c.audiencePublicUrl) return c.audiencePublicUrl;
    const lan = (this._lanCache && this._lanCache.urls[0]) || `http://127.0.0.1:${this.port}`;
    if (c.audiencePort && this.pubHttp) return lan.replace(/:\d+$/, ':' + c.audiencePort) + '/';
    return lan + '/audience';
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
      for (const w of [this.ws, this.pubWs]) if (w) for (const c of w.clients) if (c.role === 'audience') this._sendAudience(c, pub);
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

  /* Installierte Schriften, die im Projekt (Theme oder Grafiken) verwendet werden */
  _usedSystemFonts() {
    const p = this.project;
    const text = JSON.stringify([p.theme, p.graphics.map((g) => g.data)]);
    return this.sysFonts.names().filter((n) => text.includes('\\"' + n + '\\"') || text.includes('"' + n + '"') || text.includes("'" + n + "'"));
  }

  _chatSourcesPayload() { return Object.assign({ t: 'chatSources', sources: this.chat.list(), summary: this.chat.summary() }, ChatHub.types()); }

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

  /* Glücksrad / Rolltext: Ergebnis festhalten, wenn die Animation vorbei ist */
  _wheelSchedule(g) { this._spinSchedule(g, 'wheel', 'wheel.finish'); }
  _spinSchedule(g, key, finishCmd) {
    this.wheelTimers = this.wheelTimers || new Map();
    clearTimeout(this.wheelTimers.get(g.id));
    const w = g.data[key];
    const ms = Math.max(0, w.startedAt + w.duration - Date.now());
    this.wheelTimers.set(g.id, setTimeout(() => {
      this.wheelTimers.delete(g.id);
      try { this.exec(finishCmd, { id: g.id, spinId: w.spinId }); } catch (_) {}
    }, ms));
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
        const i = scoreIdx(g.data, a.team);
        const v = scoreGet(g.data, i) + (a.delta === undefined || a.delta === '' ? 1 : (Number(a.delta) || 0));
        scorePut(g.data, i, v);
        return done({ value: v, team: Types.scoreTeams(g.data)[i].key });
      }
      case 'score.set': {
        const g = this.findGraphic(a.id);
        if (a.team !== undefined) scorePut(g.data, scoreIdx(g.data, a.team), Number(a.value) || 0);
        // auch direkt: { a: 3, b: 1, c: 7 … }
        Types.scoreTeams(g.data).forEach((t, i) => { if (a[t.key] !== undefined && a[t.key] !== '') scorePut(g.data, i, Number(a[t.key]) || 0); });
        return done();
      }
      case 'score.reset': {
        const g = this.findGraphic(a.id);
        Types.scoreTeams(g.data).forEach((t, i) => scorePut(g.data, i, 0));
        return done();
      }
      case 'score.team.add': {
        const g = this.findGraphic(a.id);
        if (!Array.isArray(g.data.moreTeams)) g.data.moreTeams = [];
        if (g.data.moreTeams.length >= 24) throw Object.assign(new Error('Maximal 26 Teams'), { code: 400 });
        const key = String.fromCharCode(99 + g.data.moreTeams.length);
        g.data.moreTeams.push({ name: String(a.name || '').slice(0, 60) || 'Team ' + key.toUpperCase(), score: Number(a.score) || 0, color: a.color || Types.TEAM_COLORS[g.data.moreTeams.length % Types.TEAM_COLORS.length], logo: '' });
        return done({ team: key });
      }
      case 'score.team.remove': {
        const g = this.findGraphic(a.id);
        const i = scoreIdx(g.data, a.team);
        if (i < 2) throw Object.assign(new Error('Team A und B können nicht entfernt werden'), { code: 400 });
        g.data.moreTeams.splice(i - 2, 1);
        return done();
      }
      case 'score.swap': {
        const g = this.findGraphic(a.id); const d = g.data;
        [d.teamA, d.teamB] = [d.teamB, d.teamA]; [d.scoreA, d.scoreB] = [d.scoreB, d.scoreA];
        [d.colorA, d.colorB] = [d.colorB, d.colorA]; [d.logoA, d.logoB] = [d.logoB, d.logoA];
        return done();
      }

      /* Glücksrad */
      case 'wheel.spin': {
        const g = this.findGraphic(a.id); const d = g.data;
        const w = d.wheel = Object.assign({ history: [], excluded: [], angle: 0 }, d.wheel || {});
        if (w.spinning && now < w.startedAt + w.duration + 500) throw new HttpError(409, 'Das Rad dreht sich noch');
        let list = Types.wheelEntries(d);
        if (!list.length && w.excluded.length) { w.excluded = []; list = Types.wheelEntries(d); } // alle gezogen → neu befüllen
        if (!list.length) throw new HttpError(400, 'Das Glücksrad hat keine Felder');
        let cand = list.map((_, i) => i);
        if (d.avoidRepeat !== false && list.length > 1 && w.result) { const c = cand.filter((i) => list[i] !== w.result); if (c.length) cand = c; }
        const i = cand[require('crypto').randomInt(cand.length)];
        const n = list.length, seg = 360 / n;
        const from = ((Number(w.angle) || 0) % 360 + 360) % 360;
        const target = ((360 - (i + 0.15 + Math.random() * 0.7) * seg) % 360 + 360) % 360;
        const delta = ((target - from) % 360 + 360) % 360;
        const secs = Math.max(1, Math.min(30, Number(d.spinSeconds) || 6));
        Object.assign(w, {
          spinId: uid(6), entries: list, target: i, from, to: from + Math.max(1, Math.round(Number(d.rotations) || 6)) * 360 + delta,
          startedAt: now + 200, duration: secs * 1000, spinning: true, result: '', resultAt: 0, resultHidden: false
        });
        this._wheelSchedule(g);
        return done({ spinning: true, spinId: w.spinId, ms: w.duration + 200 });
      }
      case 'wheel.finish': {
        const g = this.findGraphic(a.id); const d = g.data; const w = d.wheel;
        if (!w || !w.spinning || (a.spinId && a.spinId !== w.spinId)) return false;
        const label = w.entries[w.target];
        Object.assign(w, { spinning: false, result: label, resultAt: now, angle: w.to % 360 });
        w.from = w.to = w.angle;
        w.history = [{ label, ts: now }].concat(w.history || []).slice(0, 500);
        if (d.removeWinner) w.excluded = (w.excluded || []).concat([label]);
        const vn = cleanVarName(d.resultVar || '');
        if (d.resultVar && vn) p.variables.text[vn] = label;
        return done({ result: label });
      }
      case 'wheel.hideResult': { const g = this.findGraphic(a.id); if (g.data.wheel) g.data.wheel.resultHidden = true; return done(); }
      case 'wheel.refill': { const g = this.findGraphic(a.id); if (g.data.wheel) g.data.wheel.excluded = []; return done(); }
      case 'wheel.history.clear': { const g = this.findGraphic(a.id); if (g.data.wheel) g.data.wheel.history = []; return done(); }

      /* Rolltext: zufälliger Wert, jeder nur einmal */
      case 'slot.spin': {
        const g = this.findGraphic(a.id); const d = g.data;
        const st = d.slot = Object.assign({ drawn: [], history: [] }, d.slot || {});
        if (st.spinning && now < st.startedAt + st.duration + 500) throw new HttpError(409, 'Es rollt noch');
        let { all, left } = Types.slotLeft(d);
        if (!all.length) throw new HttpError(400, 'Keine Werte eingetragen');
        if (!left.length) {
          if (!d.autoRefill) throw new HttpError(409, 'Alle Werte wurden schon gezogen – bitte zurücksetzen');
          st.drawn = []; left = Types.slotLeft(d).left;
          if (left.length > 1 && st.result) left = left.filter((x) => x !== st.result); // nicht direkt denselben Wert nochmal
        }
        const rnd = require('crypto').randomInt;
        const target = left[rnd(left.length)];
        // Walze: zufällige Folge aus allen Werten, endet auf dem Ergebnis
        const secs = Math.max(1, Math.min(20, Number(d.spinSeconds) || 4));
        const n = Math.max(12, Math.min(80, Math.round(secs * 9)));
        const strip = [st.result || all[rnd(all.length)]];
        for (let i = 1; i < n; i++) { let v; do { v = all[rnd(all.length)]; } while (all.length > 1 && v === strip[i - 1]); strip.push(v); }
        if (all.length > 1 && strip[n - 1] === target) strip[n - 1] = all.find((x) => x !== target);
        strip.push(target);
        Object.assign(st, { spinId: uid(6), strip, target, startedAt: now + 200, duration: secs * 1000, spinning: true, result: '', resultAt: 0 });
        this._spinSchedule(g, 'slot', 'slot.finish');
        return done({ spinning: true, spinId: st.spinId, ms: st.duration + 200, left: left.length - 1 });
      }
      case 'slot.finish': {
        const g = this.findGraphic(a.id); const d = g.data; const st = d.slot;
        if (!st || !st.spinning || (a.spinId && a.spinId !== st.spinId)) return false;
        Object.assign(st, { spinning: false, result: st.target, resultAt: now });
        st.drawn = (st.drawn || []).concat([st.target]);
        st.history = [{ label: st.target, ts: now }].concat(st.history || []).slice(0, 500);
        const vn = cleanVarName(d.resultVar || '');
        if (d.resultVar && vn) p.variables.text[vn] = st.target;
        return done({ result: st.target });
      }
      case 'slot.reset': { const g = this.findGraphic(a.id); const st = g.data.slot; if (st && !st.spinning) { st.drawn = []; st.result = ''; } return done(); }
      case 'slot.history.clear': { const g = this.findGraphic(a.id); if (g.data.slot) g.data.slot.history = []; return done(); }

      /* Rangliste */
      case 'board.add': case 'board.set': {
        const g = this.findGraphic(a.id); const e = boardEntry(g.data, a.entry);
        const v = cmd === 'board.set' ? Number(a.value) || 0 : (Number(e.score) || 0) + (a.delta === undefined || a.delta === '' ? 1 : (Number(a.delta) || 0));
        e.score = Math.round(v * 1000) / 1000;
        return done({ value: e.score });
      }
      case 'board.reset': { const g = this.findGraphic(a.id); (g.data.entries || []).forEach((e) => { e.score = 0; }); return done(); }
      case 'board.entry.add': {
        const g = this.findGraphic(a.id);
        if (!Array.isArray(g.data.entries)) g.data.entries = [];
        if (g.data.entries.length >= 100) throw new HttpError(400, 'Maximal 100 Einträge');
        g.data.entries.push({ name: String(a.name || '').slice(0, 80) || `Eintrag ${g.data.entries.length + 1}`, score: Number(a.score) || 0, note: '', image: '' });
        return done({ entry: g.data.entries.length });
      }
      case 'board.entry.remove': {
        const g = this.findGraphic(a.id); const e = boardEntry(g.data, a.entry);
        g.data.entries.splice(g.data.entries.indexOf(e), 1);
        return done();
      }

      /* Kamerarahmen: Effekt auslösen */
      case 'frame.fx': {
        const g = this.findGraphic(a.id); const d = g.data;
        const kind = String(a.fx || a.effect || '').toLowerCase();
        if (!Types.FRAME_FX.some(([k]) => k === kind)) throw new HttpError(400, `Unbekannter Effekt: ${kind || '(leer)'} – möglich: ${Types.FRAME_FX.map(([k]) => k).join(', ')}`);
        if (kind === 'damage') d.hp = Math.max(0, (Number(d.hp) || 0) - (a.amount !== undefined ? Number(a.amount) || 0 : 10));
        if (kind === 'heal') d.hp = a.amount !== undefined ? Math.min(100, (Number(d.hp) || 0) + (Number(a.amount) || 0)) : 100;
        d.fx = { kind, id: uid(6), at: now, amount: kind === 'damage' ? (a.amount !== undefined ? Number(a.amount) || 0 : 10) : undefined };
        return done({ fx: kind, hp: d.hp });
      }

      /* Webseite */
      case 'web.reload': { const g = this.findGraphic(a.id); g.data.reloadKey = (Number(g.data.reloadKey) || 0) + 1; return done(); }

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
      /* Eigene Kamerarahmen als Vorlage (gelten für alle Projekte dieses Rechners) */
      case 'frame.template.save': {
        const name = String(a.name || '').trim().slice(0, 60);
        if (!name) throw new HttpError(400, 'Bitte einen Namen angeben');
        if (!Array.isArray(a.layers) || !a.layers.length) throw new HttpError(400, 'Der Rahmen hat noch keine Bausteine');
        const layers = JSON.parse(JSON.stringify(a.layers)).slice(0, 60);
        const list = this.store.config.frameTemplates || (this.store.config.frameTemplates = []);
        let t = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (t) Object.assign(t, { name, layers, updated: Date.now() });
        else { t = { id: require('crypto').randomBytes(5).toString('hex'), name, layers, created: Date.now() }; list.push(t); }
        this.store.saveConfig();
        return done({ id: t.id, overwritten: !!t.updated });
      }
      case 'frame.template.delete': {
        const list = this.store.config.frameTemplates || [];
        const i = list.findIndex((x) => x.id === a.id);
        if (i < 0) throw new HttpError(404, 'Vorlage nicht gefunden');
        list.splice(i, 1);
        this.store.saveConfig();
        return done();
      }
      /* Eigene Theme-Vorlagen (gelten für alle Projekte dieses Rechners) */
      case 'theme.template.save': {
        const name = String(a.name || '').trim().slice(0, 60);
        if (!name) throw new HttpError(400, 'Bitte einen Namen angeben');
        const list = this.store.config.themeTemplates || (this.store.config.themeTemplates = []);
        const theme = JSON.parse(JSON.stringify(p.theme)); delete theme.preset;
        let t = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (t) { t.theme = theme; t.name = name; t.updated = Date.now(); }
        else { t = { id: require('crypto').randomBytes(5).toString('hex'), name, created: Date.now(), theme }; list.push(t); }
        p.theme.preset = 'tpl:' + t.id;
        this.store.saveConfig();
        return done({ id: t.id, overwritten: !!t.updated });
      }
      case 'theme.template.apply': {
        const t = (this.store.config.themeTemplates || []).find((x) => x.id === a.id);
        if (!t) throw new HttpError(404, 'Vorlage nicht gefunden');
        Object.assign(p.theme, JSON.parse(JSON.stringify(t.theme)), { preset: 'tpl:' + t.id });
        return done();
      }
      case 'theme.template.delete': {
        const list = this.store.config.themeTemplates || [];
        const i = list.findIndex((x) => x.id === a.id);
        if (i < 0) throw new HttpError(404, 'Vorlage nicht gefunden');
        list.splice(i, 1);
        this.store.saveConfig();
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

      case 'audio.out': {
        // Ton-Ausgabe der Desktop-App: welcher Ausgang, welches Audiogerät ('' = Systemeinstellung)
        const c = this.store.config;
        const cur = Object.assign({ enabled: true, output: '1', deviceId: '', label: '' }, c.audioOut || {});
        if (a.enabled !== undefined) cur.enabled = !!a.enabled;
        if (a.output !== undefined) cur.output = String(a.output);
        if (a.deviceId !== undefined) { cur.deviceId = String(a.deviceId || '').slice(0, 200); cur.label = String(a.label || '').slice(0, 200); }
        c.audioOut = cur;
        this.store.saveConfig();
        this.emit('audioOut', cur);
        return done();
      }
      case 'audience.access': {
        const c = this.store.config;
        if (a.publicUrl !== undefined) {
          let u = String(a.publicUrl || '').trim().replace(/\/+$/, '');
          if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
          c.audiencePublicUrl = u.slice(0, 300);
        }
        let restart = false;
        if (a.port !== undefined) {
          const n = Number(a.port) || 0;
          if (n !== 0 && (n < 1024 || n > 65535)) throw new HttpError(400, 'Port muss zwischen 1024 und 65535 liegen (0 = aus)');
          if (n === this.port) throw new HttpError(400, 'Der öffentliche Port muss sich vom Steuerungs-Port unterscheiden');
          if (n !== c.audiencePort) { c.audiencePort = n; restart = true; }
        }
        this.store.saveConfig();
        if (restart) this._startPublic().then(() => this.changed());
        this._lanCache = null;
        return done();
      }
      case 'chat.connect': return { sourceId: this.chat.legacyConnect(a.channel) };
      case 'chat.disconnect': return this.chat.disableAll();
      case 'chat.source.add': return { id: this.chat.add(a.preset || a.type, a.values, { enable: !!a.enabled }) };
      case 'chat.source.update': return this.chat.update(a.id, a);
      case 'chat.source.remove': return this.chat.remove(a.id);
      case 'chat.source.reconnect': return this.chat.reconnect(a.id);
      case 'chat.clear': this.chatLog = []; this._broadcastControl({ t: 'chatLog', log: [] }); return true;
      case 'chat.show': {
        const m = this.chatLog.find((x) => x.id === a.msgId) || a.msg;
        if (!m) throw new HttpError(404, 'Nachricht nicht gefunden');
        let g = a.graphicId ? this.findGraphic(a.graphicId) : p.graphics.find((x) => x.type === 'social');
        if (!g) { g = this.store.makeGraphic('social', 'Chat-Nachricht'); p.graphics.push(g); }
        Object.assign(g.data, { platform: m.platform || 'twitch', author: m.author, message: m.amount ? `💰 ${m.amount}${m.text && !String(m.amount).toLowerCase().includes(String(m.text).toLowerCase()) ? ' · ' + m.text : ''}` : m.text, color: m.color || '', avatar: m.avatar || '' });
        if (a.live !== false) this._setLive(g, true); else g.preview = true;
        return done({ graphicId: g.id });
      }

      default: {
        if (cmd.startsWith('qa.') || cmd.startsWith('poll.') || cmd === 'audience.design') {
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
    const open = route === 'qr.svg' || route === 'fonts.css' || route === 'info' || route === 'theme.css' || route === 'audience.css' || route.startsWith('sysfont/');
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
      const sys = this.sysFonts.ready ? this.sysFonts.css(this._usedSystemFonts()) : '';
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(css + (sys ? '\n' + sys : '')); return;
    }
    if (route === 'audience.css') return this._audienceCss(res);
    if (route === 'system-fonts') return this._json(res, { ready: this.sysFonts.ready, families: this.sysFonts.list() });
    if (parts[0] === 'sysfont' && parts[1]) {
      // Nur Dateien aus der Scan-Liste ausliefern (Index), nie beliebige Pfade
      const file = this.sysFonts.file(parseInt(parts[1], 10));
      if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Schrift nicht gefunden');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'font/ttf', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(file).pipe(res); return;
    }
    if (route === 'info') return this._json(res, { app: 'CueGFX', version: VERSION, build: BUILD, port: this.port, lan: this.lanUrls(), pin: !!this.store.config.accessPin, desktop: !!this.hooks.desktop });

    if (route === 'state') return this._json(res, { project: this.project, vars: this.variables(), serverTime: Date.now() });
    if (route === 'audience-test' && m === 'POST') {
      const a = await this._args(req, url);
      return this._json(res, await this._testAudienceUrl(a.url || this.store.config.audiencePublicUrl));
    }
    if (route === 'cmd' && m === 'POST') {
      const a = await this._args(req, url);
      if (!a.cmd || typeof a.cmd !== 'string') throw new HttpError(400, 'Befehl fehlt: {"cmd": "…", "args": {…}}');
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
        'timer-set': 'timer.set', 'timer-add': 'timer.add', score: 'score.add', 'score-set': 'score.set', 'score-reset': 'score.reset', 'team-add': 'score.team.add', 'team-remove': 'score.team.remove',
        spin: 'wheel.spin', 'wheel-refill': 'wheel.refill', 'wheel-hide': 'wheel.hideResult', board: 'board.add', 'board-set': 'board.set', 'board-reset': 'board.reset', 'board-entry': 'board.entry.add', reload: 'web.reload', fx: 'frame.fx', roll: 'slot.spin', 'roll-reset': 'slot.reset',
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
    if (parts[0] === 'qa' && /^export\.(md|html|pdf)$/.test(parts[1] || '') && m === 'GET') return this._qaExport(res, url, parts[1].split('.')[1]);
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

/* Rangliste: Eintrag per Nummer (1 = erster in der Liste) oder Name */
function boardEntry(d, ref) {
  const list = Array.isArray(d.entries) ? d.entries : [];
  const s = String(ref === undefined || ref === null ? '' : ref).trim();
  let e = /^\d+$/.test(s) ? list[Number(s) - 1] : null;
  if (!e && s) e = list.find((x) => String(x.name || '').toLowerCase() === s.toLowerCase());
  if (!e) throw new HttpError(400, `Eintrag nicht gefunden: ${s || '(leer)'}`);
  return e;
}

/* Spielstand-Helfer: Team per Buchstabe/Nummer finden, Punkte lesen und schreiben */
function scoreIdx(d, team) {
  const i = Types.teamIndex(d, team);
  if (i < 0) throw Object.assign(new Error(`Unbekanntes Team: ${team} (vorhanden: ${Types.scoreTeams(d).map((t) => t.key.toUpperCase()).join(', ')})`), { code: 400 });
  return i;
}
function scoreGet(d, i) { return i === 0 ? Number(d.scoreA) || 0 : i === 1 ? Number(d.scoreB) || 0 : Number((d.moreTeams[i - 2] || {}).score) || 0; }
function scorePut(d, i, v) {
  if (i === 0) d.scoreA = v; else if (i === 1) d.scoreB = v;
  else d.moreTeams[i - 2] = Object.assign({}, d.moreTeams[i - 2], { score: v });
}

function coerce(type, key, v) {
  const f = Types.allFields(type).find((x) => x.key === key);
  if (!f) return v;
  if (f.type === 'number') { const n = Number(v); return isNaN(n) ? 0 : n; }
  if (f.type === 'toggle') return v === true || v === 'true' || v === '1' || v === 1 || v === 'on';
  if (f.type === 'list' || f.type === 'builder' || f.type === 'framebuilder') {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return []; } }
    return Array.isArray(v) ? v : [];
  }
  if (f.type === 'timer') return typeof v === 'object' && v ? v : Types.defaultTimer(parseTime(v));
  return v === null || v === undefined ? '' : String(v);
}

module.exports = { CueServer, parseTime };
