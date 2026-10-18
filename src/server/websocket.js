'use strict';
/* Minimaler, abhängigkeitsfreier WebSocket-Server (RFC 6455) – Text-Frames, Ping/Pong, Fragmentierung */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024 * 1024;

class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.open = true;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2), lo = this.buf.readUInt32BE(6);
        len = hi * 0x100000000 + lo; off = 10;
      }
      if (len > MAX_PAYLOAD) { this.close(1009); return; }
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      off += maskLen;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + len);
      this._frame(fin, opcode, payload);
      if (!this.open) return;
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(); return; }
    if (opcode === 0x9) { this._send(0xA, payload); return; }
    if (opcode === 0xA) { this.alive = true; return; }
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) { this._message(opcode, payload); return; }
      this.fragOpcode = opcode; this.fragments = [payload]; return;
    }
    if (opcode === 0x0) {
      this.fragments.push(payload);
      if (fin) {
        const all = Buffer.concat(this.fragments);
        this.fragments = [];
        this._message(this.fragOpcode, all);
      }
    }
  }

  _message(opcode, payload) {
    this.alive = true;
    this.emit('message', opcode === 0x1 ? payload.toString('utf8') : payload);
  }

  _send(opcode, data) {
    if (!this.open) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeUInt32BE(Math.floor(len / 0x100000000), 2); header.writeUInt32BE(len >>> 0, 6); }
    header[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([header, payload])); } catch (_) { this._closed(); }
  }

  send(text) { this._send(0x1, text); }

  ping() { this._send(0x9, Buffer.alloc(0)); }

  close(code) {
    if (!this.open) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000, 0);
    this._send(0x8, b);
    this.open = false;
    try { this.socket.end(); } catch (_) {}
    this.emit('close');
  }
}

class WsServer extends EventEmitter {
  constructor(httpServer, opts = {}) {
    super();
    this.clients = new Set();
    this.path = opts.path || '/ws';
    this.verify = opts.verify || (() => true);
    httpServer.on('upgrade', (req, socket) => this._upgrade(req, socket));
    this.pingTimer = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) { c.close(1001); continue; }
        c.alive = false; c.ping();
      }
    }, 20000);
  }

  _upgrade(req, socket) {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== this.path || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !this.verify(req, url)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = new WsConnection(socket, req);
    conn.query = url.searchParams;
    this.clients.add(conn);
    conn.on('close', () => this.clients.delete(conn));
    this.emit('connection', conn, req);
  }

  broadcast(text, filter) {
    for (const c of this.clients) if (!filter || filter(c)) c.send(text);
  }

  close() {
    clearInterval(this.pingTimer);
    for (const c of this.clients) c.close(1001);
  }
}

module.exports = { WsServer };
