'use strict';
/*
 * Chat-Hub: verwaltet beliebig viele Chat-Quellen (Twitch, YouTube, Facebook, Instagram,
 * TikTok über Social Stream Ninja …), führt sie zu einem gemeinsamen Nachrichtenstrom zusammen
 * und verbindet aktivierte Quellen beim Start automatisch.
 * Die Quellen samt Zugangsschlüsseln liegen in config.json dieses Rechners – nicht im Projekt,
 * damit sie beim Projekt-Export nicht weitergegeben werden.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { TwitchChat } = require('./twitch');
const { YouTubeChat } = require('./youtube');
const { FacebookChat, InstagramChat } = require('./meta');
const { SocialStreamNinja } = require('./ssn');
const { secretMask } = require('./base');

/* Twitch-Client an die gemeinsame Schnittstelle anpassen */
class TwitchSource extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg; this.state = 'off'; this.status = 'getrennt';
    this.c = new TwitchChat();
    this.c.on('message', (m) => this.emit('message', Object.assign({}, m, { id: 'tw:' + m.id })));
    this.c.on('status', (s) => {
      this.status = s;
      this.state = /^verbunden/.test(s) ? 'live' : /^Fehler/.test(s) ? 'error' : /getrennt/.test(s) && !this.c.wanted ? 'off' : 'waiting';
      this.emit('status', s);
    });
  }
  start() { this.c.connect(this.cfg.channel); }
  stop() { this.c.disconnect(); }
}

const TYPES = {
  twitch: {
    label: 'Twitch', platform: 'twitch', create: (c) => new TwitchSource(c),
    fields: [{ key: 'channel', label: 'Kanal', placeholder: 'meinkanal oder twitch.tv/meinkanal' }],
    hint: 'Liest den öffentlichen Chat anonym mit – kein Login nötig.'
  },
  youtube: {
    label: 'YouTube', platform: 'youtube', create: (c, o) => new YouTubeChat(c, o),
    fields: [
      { key: 'channel', label: 'Kanal oder Video', placeholder: '@meinkanal, Kanal-URL oder Video-Link' },
      { key: 'apiKey', label: 'API-Schlüssel (optional)', secret: true, placeholder: 'leer = ohne Schlüssel' }
    ],
    hint: 'Mit Kanal (@name) verbindet sich CueGFX automatisch, sobald ihr live geht. Ohne API-Schlüssel wird der öffentliche Chat wie im Browser gelesen; mit Schlüssel über die offizielle YouTube-API (Tageskontingent reicht für ca. 3 Stunden).'
  },
  facebook: {
    label: 'Facebook', platform: 'facebook', create: (c, o) => new FacebookChat(c, o),
    fields: [
      { key: 'pageId', label: 'Seiten-ID', placeholder: 'z. B. 1234567890 (leer = Seite des Tokens)' },
      { key: 'token', label: 'Seiten-Zugangsschlüssel', secret: true, placeholder: 'Page Access Token' },
      { key: 'videoId', label: 'Live-Video-ID (optional)', placeholder: 'leer = automatisch erkennen' }
    ],
    hint: 'Offizielle Meta-Schnittstelle. Benötigt eine eigene Meta-App und einen Seiten-Token mit pages_read_engagement und pages_read_user_content. Live-Streams der Seite werden automatisch erkannt.'
  },
  instagram: {
    label: 'Instagram', platform: 'instagram', create: (c, o) => new InstagramChat(c, o),
    fields: [
      { key: 'userId', label: 'Instagram-Konto-ID', placeholder: 'bei IG-Token leer lassen' },
      { key: 'token', label: 'Zugangsschlüssel', secret: true, placeholder: 'Access Token' }
    ],
    hint: 'Offizielle Meta-Schnittstelle für Business- und Creator-Konten (instagram_basic + instagram_manage_comments). Alternativ Instagram über Social Stream Ninja.'
  },
  ssn: {
    label: 'Social Stream Ninja', platform: 'custom', create: (c, o) => new SocialStreamNinja(c, o),
    fields: [
      { key: 'session', label: 'Sitzungs-ID', placeholder: 'aus Social Stream Ninja (session=…)' },
      { key: 'platforms', label: 'Nur diese Plattformen (optional)', placeholder: 'z. B. tiktok oder tiktok, instagram' },
      { key: 'server', label: 'Server (optional)', placeholder: 'wss://io.socialstream.ninja' }
    ],
    hint: 'Für TikTok und alle Plattformen ohne offizielle Chat-Schnittstelle. In Social Stream Ninja unter Global settings → Mechanics „Enable remote API control“ und „Send chat messages to API server“ einschalten.'
  }
};
/* Vorlagen für die Schaltflächen „+ Quelle“ */
const PRESETS = [
  { key: 'twitch', type: 'twitch', label: 'Twitch' },
  { key: 'youtube', type: 'youtube', label: 'YouTube' },
  { key: 'facebook', type: 'facebook', label: 'Facebook' },
  { key: 'instagram', type: 'instagram', label: 'Instagram' },
  { key: 'tiktok', type: 'ssn', label: 'TikTok', name: 'TikTok', values: { platforms: 'tiktok' } },
  { key: 'ssn', type: 'ssn', label: 'Social Stream Ninja (alle)' }
];

class ChatHub extends EventEmitter {
  constructor(store, opts) {
    super();
    this.store = store;
    this.opts = opts || {};
    this.sources = new Map();
    if (!Array.isArray(store.config.chatSources)) store.config.chatSources = [];
  }

  get configs() { return this.store.config.chatSources; }

  /* Beim Start: alle Quellen anlegen, aktivierte verbinden */
  init() {
    for (const cfg of this.configs) this._create(cfg);
    for (const cfg of this.configs) if (cfg.enabled) this._start(cfg.id);
  }

  _create(cfg) {
    const T = TYPES[cfg.type];
    if (!T) return null;
    const conn = T.create(cfg.values || (cfg.values = {}), this.opts);
    const src = { cfg, conn, count: 0 };
    conn.on('message', (m) => {
      src.count++;
      this.emit('message', Object.assign({ platform: T.platform }, m, { sourceId: cfg.id, source: cfg.name || T.label, platform: m.platform || T.platform }));
    });
    conn.on('status', () => this.emit('change'));
    this.sources.set(cfg.id, src);
    return src;
  }

  _start(id) {
    const s = this.sources.get(id); if (!s) return;
    try { s.conn.start(); } catch (e) { s.conn.status = 'Fehler: ' + e.message; s.conn.state = 'error'; }
    this.emit('change');
  }
  _stop(id) { const s = this.sources.get(id); if (s) { s.conn.stop(); this.emit('change'); } }

  _save() { this.store.saveConfig(); this.emit('change'); }
  _find(id) { const cfg = this.configs.find((c) => c.id === id); if (!cfg) throw Object.assign(new Error('Chat-Quelle nicht gefunden'), { code: 404 }); return cfg; }

  add(preset, values, opts) {
    const P = PRESETS.find((p) => p.key === preset) || PRESETS.find((p) => p.type === preset);
    if (!P) throw Object.assign(new Error('Unbekannte Plattform: ' + preset), { code: 400 });
    const cfg = { id: crypto.randomBytes(5).toString('hex'), type: P.type, name: P.name || '', enabled: false, values: Object.assign({}, P.values || {}) };
    this._apply(cfg, values || {});
    this.configs.push(cfg);
    this._create(cfg);
    if (opts && opts.enable) { cfg.enabled = true; this._start(cfg.id); }
    this._save();
    return cfg.id;
  }

  _apply(cfg, values) {
    const T = TYPES[cfg.type];
    for (const f of T.fields) {
      if (!(f.key in values)) continue;
      let v = String(values[f.key] === null || values[f.key] === undefined ? '' : values[f.key]).trim();
      if (f.secret && v.startsWith('••••')) continue; // maskierter Wert = unverändert lassen
      cfg.values[f.key] = v;
    }
  }

  update(id, patch) {
    const cfg = this._find(id);
    let restart = false;
    if (patch.values) { this._apply(cfg, patch.values); restart = true; }
    if (typeof patch.name === 'string') cfg.name = patch.name.trim().slice(0, 40);
    if (typeof patch.enabled === 'boolean' && patch.enabled !== cfg.enabled) { cfg.enabled = patch.enabled; restart = true; }
    if (restart) { this._stop(id); if (cfg.enabled) this._start(id); }
    this._save();
    return true;
  }

  remove(id) {
    this._find(id);
    this._stop(id);
    this.sources.delete(id);
    this.store.config.chatSources = this.configs.filter((c) => c.id !== id);
    this._save();
    return true;
  }

  reconnect(id) { const cfg = this._find(id); cfg.enabled = true; this._stop(id); this._start(id); this._save(); return true; }

  stopAll() { for (const id of this.sources.keys()) this.sources.get(id).conn.stop(); }

  /* Kompatibilität zu älteren Befehlen (chat.connect / chat.disconnect) */
  legacyConnect(channel) {
    const tw = this.configs.find((c) => c.type === 'twitch');
    if (tw) { this.update(tw.id, { values: { channel }, enabled: true }); return tw.id; }
    return this.add('twitch', { channel }, { enable: true });
  }
  disableAll() { for (const c of this.configs) if (c.enabled) this.update(c.id, { enabled: false }); return true; }

  /* Öffentliche Sicht für die Steueroberfläche (Schlüssel maskiert) */
  list() {
    return this.configs.map((cfg) => {
      const T = TYPES[cfg.type] || { fields: [], label: cfg.type };
      const s = this.sources.get(cfg.id);
      const values = {};
      for (const f of T.fields) values[f.key] = f.secret ? secretMask(cfg.values[f.key]) : (cfg.values[f.key] || '');
      return { id: cfg.id, type: cfg.type, label: T.label, platform: T.platform, name: cfg.name || '', enabled: !!cfg.enabled, values,
        status: s ? s.conn.status : 'getrennt', state: s ? s.conn.state : 'off', count: s ? s.count : 0 };
    });
  }
  summary() {
    const l = this.list().filter((x) => x.enabled);
    if (!l.length) return 'keine Quelle aktiv';
    const live = l.filter((x) => x.state === 'live').length;
    return `${live}/${l.length} Quellen live`;
  }
  static types() {
    const t = {};
    for (const [k, v] of Object.entries(TYPES)) t[k] = { label: v.label, platform: v.platform, fields: v.fields, hint: v.hint };
    return { types: t, presets: PRESETS.map((p) => ({ key: p.key, label: p.label, type: p.type })) };
  }
}

module.exports = { ChatHub, TYPES, PRESETS };
