'use strict';
/* Gemeinsame Basis für alle Chat-Quellen: Status, Abfrage-Schleife, Doppelte filtern, HTTP-Helfer */
const { EventEmitter } = require('events');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

class Connector extends EventEmitter {
  constructor(cfg, opts) {
    super();
    this.cfg = cfg || {};
    this.opts = opts || {};
    this.status = 'getrennt';
    this.state = 'off'; // off | waiting | live | error
    this.running = false;
    this.timer = null;
    this.seen = new Set();
    this.errors = 0;
    this.backlog = 15; // so viele ältere Nachrichten beim Verbinden übernehmen
  }

  setStatus(text, state) {
    if (state) this.state = state;
    if (text === this.status) return;
    this.status = text;
    this.emit('status', text);
  }

  start() {
    this.stop(true);
    this.running = true;
    this.setStatus('verbinde…', 'waiting');
    this._schedule(0);
  }

  stop(silent) {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.abort) { try { this.abort.abort(); } catch (_) {} this.abort = null; }
    if (typeof this.onStop === 'function') this.onStop();
    if (!silent) this.setStatus('getrennt', 'off');
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      if (!this.running) return;
      let next;
      try {
        next = await this.tick();
        this.errors = 0;
      } catch (e) {
        if (!this.running) return;
        this.errors++;
        this.setStatus('Fehler: ' + (e && e.message ? e.message : String(e)), 'error');
        next = Math.min(60000, 5000 * this.errors);
      }
      this._schedule(typeof next === 'number' ? next : 5000);
    }, ms);
  }

  /* Nachricht weitergeben, Doppelte verwerfen */
  push(m) {
    if (!m || !m.id || this.seen.has(m.id)) return false;
    this.seen.add(m.id);
    if (this.seen.size > 3000) { const first = this.seen.values().next().value; this.seen.delete(first); }
    const text = String(m.text || '').trim();
    if (!text && !m.amount) return false;
    this.emit('message', {
      id: String(m.id),
      platform: m.platform,
      author: String(m.author || 'Unbekannt').slice(0, 80),
      text: text.slice(0, 600),
      color: m.color || '',
      avatar: m.avatar || '',
      amount: m.amount || '',
      badges: m.badges || '',
      ts: m.ts || Date.now()
    });
    return true;
  }

  /* Beim ersten Abruf nur die letzten Nachrichten übernehmen, Rest als „gesehen“ markieren */
  pushBatch(list, first) {
    const items = list.filter((m) => m && m.id && !this.seen.has(m.id));
    const keep = first ? items.slice(-this.backlog) : items;
    if (first) for (const m of items.slice(0, items.length - keep.length)) this.seen.add(m.id);
    for (const m of keep) this.push(m);
  }

  async http(url, init) {
    this.abort = new AbortController();
    const t = setTimeout(() => this.abort && this.abort.abort(), (init && init.timeout) || 15000);
    try {
      const res = await fetch(url, Object.assign({ signal: this.abort.signal, redirect: 'follow' }, init || {}, {
        headers: Object.assign({ 'user-agent': UA, 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' }, (init && init.headers) || {})
      }));
      return res;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error(this.running ? 'Zeitüberschreitung' : 'abgebrochen');
      throw new Error('Netzwerk: ' + (e.cause && e.cause.code ? e.cause.code : e.message));
    } finally { clearTimeout(t); }
  }

  async json(url, init) {
    const res = await this.http(url, init);
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (_) {}
    if (!res.ok) {
      const err = new Error(apiError(data) || `HTTP ${res.status}`);
      err.status = res.status; err.data = data;
      throw err;
    }
    if (data === null) throw new Error('Ungültige Antwort');
    return data;
  }
}

function apiError(d) {
  if (!d || typeof d !== 'object') return '';
  const e = d.error;
  if (!e) return '';
  if (typeof e === 'string') return e;
  return e.message || (e.errors && e.errors[0] && e.errors[0].reason) || '';
}

/* HTML-Text (z. B. von Social Stream Ninja) in reinen Text wandeln */
function stripHtml(s) {
  return String(s || '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

const secretMask = (v) => (v ? '••••' + String(v).slice(-4) : '');

module.exports = { Connector, stripHtml, secretMask, UA };
