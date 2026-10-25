'use strict';
/*
 * Social Stream Ninja (https://socialstream.ninja) als Brücke.
 * Damit kommen Plattformen ohne offizielle Chat-Schnittstelle dazu – vor allem TikTok,
 * aber auch Instagram, Facebook, Kick, Rumble u. v. m. Die Browser-Erweiterung bzw. App
 * „Social Stream Ninja“ liest die Chats, CueGFX empfängt sie über deren API-Server.
 *
 * In Social Stream Ninja: Global settings → Mechanics → „Enable remote API control“ (Toggle 1)
 * und „Send chat messages to API server“ (Toggle 3) einschalten, Sitzungs-ID hier eintragen.
 */
const { Connector, stripHtml } = require('./base');

const DEFAULT_SERVER = 'wss://io.socialstream.ninja';

/* Plattform-Namen von Social Stream Ninja → CueGFX */
const MAP = { youtubeshorts: 'youtube', facebook: 'facebook', instagramlive: 'instagram', instagram: 'instagram', tiktok: 'tiktok', twitch: 'twitch', kick: 'kick', x: 'x', twitter: 'x', youtube: 'youtube' };

function parseMessage(raw) {
  let d = raw;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return null; } }
  if (!d || typeof d !== 'object') return null;
  d = d.overlayNinja || d.dataReceived && d.dataReceived.overlayNinja || d;
  if (!d || (!d.chatname && !d.chatmessage)) return null;
  // System-Ereignisse (Follows, Beitritte, Likes …) überspringen – Spenden/Geschenke behalten
  if (d.event && !d.hasDonation && !/donation|gift/i.test(String(d.event))) return null;
  const platform = MAP[String(d.type || '').toLowerCase()] || String(d.type || 'custom').toLowerCase();
  const text = d.textonly ? String(d.chatmessage || '') : stripHtml(d.chatmessage);
  return {
    id: 'ssn:' + (d.id !== undefined ? d.id : `${platform}:${d.chatname}:${d.timestamp || ''}:${text.slice(0, 40)}`),
    platform,
    author: stripHtml(d.chatname),
    text: text || (d.hasDonation ? 'Spende' : ''),
    avatar: /^https?:/.test(d.chatimg || '') ? d.chatimg : '',
    amount: d.hasDonation ? stripHtml(d.hasDonation) : '',
    color: d.nameColor || '',
    badges: [d.mod && 'Moderator', d.vip && 'VIP', d.membership && 'Mitglied'].filter(Boolean).join(', '),
    ts: Number(d.timestamp) || Date.now()
  };
}

class SocialStreamNinja extends Connector {
  constructor(cfg, opts) {
    super(cfg, opts);
    this.ws = null;
    this.onStop = () => { if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (_) {} } };
  }

  filter() { return String(this.cfg.platforms || '').toLowerCase().split(/[\s,;]+/).filter(Boolean); }

  /* Statt Abfrage-Schleife: dauerhafte WebSocket-Verbindung */
  async tick() {
    if (this.ws) return 30000;
    const session = String(this.cfg.session || '').trim();
    if (!session) throw new Error('Keine Sitzungs-ID eingetragen');
    if (typeof WebSocket !== 'function') throw new Error('WebSocket wird von dieser Node-Version nicht unterstützt');
    const server = String(this.cfg.server || '').trim() || this.opts.ssnServer || DEFAULT_SERVER;
    const ws = new WebSocket(server);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ join: session, out: 3, in: 4 }));
      const f = this.filter();
      this.setStatus(`verbunden mit Sitzung ${session}${f.length ? ' · nur ' + f.join(', ') : ''}`, 'live');
    };
    ws.onmessage = (ev) => {
      const m = parseMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
      if (!m) return;
      const f = this.filter();
      if (f.length && !f.includes(m.platform)) return;
      this.push(m);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.running) { this.setStatus('Verbindung getrennt – neuer Versuch…', 'error'); this._schedule(5000); }
    };
    return 30000;
  }
}

module.exports = { SocialStreamNinja, parseMessage, DEFAULT_SERVER };
