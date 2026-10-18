'use strict';
/* Anonymer, lesender Twitch-Chat-Client (IRC über TLS, kein Login nötig) */
const tls = require('tls');
const { EventEmitter } = require('events');

function parseTags(raw) {
  const tags = {};
  for (const kv of raw.split(';')) {
    const i = kv.indexOf('=');
    tags[i < 0 ? kv : kv.slice(0, i)] = i < 0 ? '' : kv.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
  }
  return tags;
}

class TwitchChat extends EventEmitter {
  constructor() {
    super();
    this.channel = '';
    this.sock = null;
    this.status = 'getrennt';
    this.wanted = false;
    this.buf = '';
    this.retry = null;
  }

  connect(channel) {
    this.disconnect();
    this.channel = String(channel || '').trim().toLowerCase().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').split(/[/?]/)[0];
    if (!this.channel) throw new Error('Kein Kanal angegeben');
    this.wanted = true;
    this._open();
  }

  _setStatus(s) { this.status = s; this.emit('status', s); }

  _open() {
    this._setStatus('verbinde…');
    const nick = 'justinfan' + Math.floor(10000 + Math.random() * 80000);
    const sock = tls.connect({ host: 'irc.chat.twitch.tv', port: 6697, servername: 'irc.chat.twitch.tv' }, () => {
      sock.write('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
      sock.write('PASS SCHMOOPIIE\r\n');
      sock.write(`NICK ${nick}\r\n`);
      sock.write(`JOIN #${this.channel}\r\n`);
    });
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d) => this._data(d));
    const onEnd = (err) => {
      if (this.sock !== sock) return;
      this.sock = null;
      this._setStatus(err ? 'Fehler: ' + err.message : 'getrennt');
      if (this.wanted) this.retry = setTimeout(() => this._open(), 5000);
    };
    sock.on('error', onEnd);
    sock.on('close', () => onEnd());
  }

  _data(d) {
    this.buf += d;
    let idx;
    while ((idx = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      this._line(line);
    }
  }

  _line(line) {
    if (line.startsWith('PING')) { this.sock && this.sock.write('PONG :tmi.twitch.tv\r\n'); return; }
    let tags = {};
    let rest = line;
    if (rest[0] === '@') {
      const sp = rest.indexOf(' ');
      tags = parseTags(rest.slice(1, sp));
      rest = rest.slice(sp + 1);
    }
    const m = rest.match(/^:([^!\s]+)![^\s]+ PRIVMSG #\S+ :([\s\S]*)$/);
    if (m) {
      let text = m[2];
      const action = text.match(/^\u0001ACTION (.*)\u0001$/);
      if (action) text = action[1];
      this.emit('message', {
        id: tags.id || String(Date.now()) + Math.random(),
        platform: 'twitch',
        author: tags['display-name'] || m[1],
        color: tags.color || '',
        text,
        badges: tags.badges || '',
        ts: Date.now()
      });
      return;
    }
    if (/ 366 /.test(rest) || / JOIN #/.test(rest)) this._setStatus('verbunden mit #' + this.channel);
    if (/NOTICE .*(Login|improperly)/i.test(rest)) this._setStatus('Fehler: ' + rest);
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.retry);
    if (this.sock) { const s = this.sock; this.sock = null; try { s.destroy(); } catch (_) {} }
    this._setStatus('getrennt');
  }
}

module.exports = { TwitchChat };
