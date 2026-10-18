/* CueGFX – WebSocket-Client mit automatischem Wiederverbinden und Uhr-Synchronisation */
(function () {
  'use strict';
  class CueClient {
    constructor(opts = {}) {
      this.role = opts.role || 'control';
      this.output = opts.output || '';
      this.params = opts.params || {};
      this.handlers = {};
      this.pending = new Map();
      this.seq = 0;
      this.offset = 0; // serverTime - localTime
      this.bestRtt = Infinity;
      this.connected = false;
      this._connect();
      this._syncTimer = setInterval(() => this._ping(), 10000);
    }
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
    emit(ev, ...a) { (this.handlers[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }
    now() { return Date.now() + this.offset; }
    _connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const q = new URLSearchParams({ role: this.role });
      if (this.output) q.set('output', this.output);
      for (const [k, v] of Object.entries(this.params || {})) q.set(k, v);
      const pin = new URLSearchParams(location.search).get('pin');
      if (pin) q.set('pin', pin);
      const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
      this.ws = ws;
      ws.onopen = () => { this.connected = true; this.bestRtt = Infinity; this.emit('open'); this._ping(); setTimeout(() => this._ping(), 300); setTimeout(() => this._ping(), 900); };
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        if (was) this.emit('close');
        for (const [, p] of this.pending) p.reject(new Error('Verbindung getrennt'));
        this.pending.clear();
        setTimeout(() => this._connect(), 1000);
      };
      ws.onerror = () => {};
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.t === 'pong') {
          const sent = this._pings && this._pings.get(m.id);
          if (sent) {
            this._pings.delete(m.id);
            const recv = Date.now(), rtt = recv - sent;
            if (rtt <= this.bestRtt * 1.5 + 5) { this.bestRtt = Math.min(this.bestRtt, rtt); this.offset = m.serverTime - (sent + rtt / 2); }
          }
          return;
        }
        if (m.t === 'res') {
          const p = this.pending.get(m.id);
          if (p) { this.pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
          return;
        }
        if (m.serverTime && this.bestRtt === Infinity) this.offset = m.serverTime - Date.now();
        this.emit(m.t, m);
      };
    }
    _ping() {
      if (!this.connected) return;
      this._pings = this._pings || new Map();
      const id = ++this.seq;
      this._pings.set(id, Date.now());
      this.ws.send(JSON.stringify({ t: 'ping', id }));
    }
    cmd(cmd, args) {
      return new Promise((resolve, reject) => {
        if (!this.connected) { reject(new Error('Keine Verbindung zum Server')); return; }
        const id = ++this.seq;
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify({ t: 'cmd', id, cmd, args }));
      });
    }
  }
  window.CueClient = CueClient;
})();
