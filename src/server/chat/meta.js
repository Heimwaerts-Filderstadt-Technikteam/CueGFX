'use strict';
/*
 * Facebook- und Instagram-Live-Kommentare über die offizielle Meta Graph API.
 * Benötigt einen Zugangsschlüssel (Access Token) aus einer eigenen Meta-App:
 *  - Facebook:  Seiten-Token mit pages_read_engagement + pages_read_user_content
 *  - Instagram: Token mit instagram_basic + instagram_manage_comments (Business-/Creator-Konto),
 *               oder ein Token aus „Instagram API mit Instagram-Login“ (beginnt mit IG…)
 * Erkennt automatisch, wann ein Livestream startet.
 */
const { Connector } = require('./base');

const GRAPH_VERSION = 'v23.0';

class MetaConnector extends Connector {
  constructor(cfg, opts) {
    super(cfg, opts);
    this.onStop = () => { this.live = null; };
  }
  base(host) {
    if (this.opts.graphBase) return this.opts.graphBase;
    return `https://${host || 'graph.facebook.com'}/${GRAPH_VERSION}`;
  }
  tokenParam() {
    const t = String(this.cfg.token || '').trim();
    if (!t) throw new Error('Kein Zugangsschlüssel (Access Token) eingetragen');
    return 'access_token=' + encodeURIComponent(t);
  }
  _ended() { this.live = null; this.setStatus('Livestream beendet – wartet auf den nächsten…', 'waiting'); return 20000; }
  explain(e) {
    const m = e.message || '';
    if (/expired|Session has expired/i.test(m)) return new Error('Zugangsschlüssel abgelaufen – bitte neuen Token eintragen');
    if (/Invalid OAuth|Malformed access token|Cannot parse access token/i.test(m)) return new Error('Zugangsschlüssel ungültig – bitte Token prüfen');
    if (/permission|OAuthException|not authorized/i.test(m)) return new Error('Fehlende Berechtigung: ' + m);
    return e;
  }
}

class FacebookChat extends MetaConnector {
  async tick() {
    try {
      if (!this.live) return await this._find();
      return await this._poll();
    } catch (e) { throw this.explain(e); }
  }

  async _find() {
    const tp = this.tokenParam();
    let id = String(this.cfg.videoId || '').trim(), title = '';
    if (!id) {
      const page = String(this.cfg.pageId || '').trim() || 'me';
      const d = await this.json(`${this.base()}/${encodeURIComponent(page)}/live_videos?broadcast_status=${encodeURIComponent('["LIVE"]')}&fields=id,title,status&limit=1&${tp}`);
      const v = (d.data || [])[0];
      if (!v) { this.setStatus('wartet auf Livestream…', 'waiting'); return 30000; }
      id = v.id; title = v.title || '';
    }
    this.live = { id, first: true, n: 0 };
    this.setStatus(`live${title ? ': ' + title : ''} (Video ${id})`, 'live');
    return 0;
  }

  async _poll() {
    const L = this.live, tp = this.tokenParam();
    // Gelegentlich prüfen, ob der Stream noch läuft
    if (!this.cfg.videoId && ++L.n % 15 === 0) {
      const st = await this.json(`${this.base()}/${L.id}?fields=status&${tp}`).catch(() => null);
      if (st && st.status && st.status !== 'LIVE') return this._ended();
    }
    let d;
    try {
      d = await this.json(`${this.base()}/${L.id}/comments?fields=id,message,created_time,from{id,name,picture}&order=reverse_chronological&filter=stream&live_filter=no_filter&limit=50&${tp}`);
    } catch (e) {
      if (/does not exist|Unsupported get request/i.test(e.message)) return this._ended();
      throw e;
    }
    const msgs = (d.data || []).slice().reverse().map((c) => ({
      id: 'fb:' + c.id, platform: 'facebook',
      author: (c.from && c.from.name) || 'Facebook-Nutzer',
      avatar: c.from && c.from.picture && c.from.picture.data ? c.from.picture.data.url : '',
      text: c.message || '', ts: Date.parse(c.created_time) || Date.now()
    }));
    this.pushBatch(msgs, L.first);
    L.first = false;
    return 3000;
  }
}

class InstagramChat extends MetaConnector {
  host() { return /^IG/.test(String(this.cfg.token || '').trim()) ? 'graph.instagram.com' : 'graph.facebook.com'; }

  async tick() {
    try {
      if (!this.live) return await this._find();
      return await this._poll();
    } catch (e) { throw this.explain(e); }
  }

  async _find() {
    const tp = this.tokenParam();
    const host = this.host();
    const user = String(this.cfg.userId || '').trim() || (host === 'graph.instagram.com' ? 'me' : '');
    if (!user) throw new Error('Instagram-Konto-ID fehlt (bei Facebook-Token erforderlich)');
    const d = await this.json(`${this.base(host)}/${encodeURIComponent(user)}/live_media?fields=id,media_product_type,timestamp&${tp}`);
    const v = (d.data || [])[0];
    if (!v) { this.setStatus('wartet auf Instagram-Live…', 'waiting'); return 30000; }
    this.live = { id: v.id, host, user, first: true, n: 0 };
    this.setStatus(`live (Medien-ID ${v.id})`, 'live');
    return 0;
  }

  async _poll() {
    const L = this.live, tp = this.tokenParam();
    if (++L.n % 15 === 0) {
      const d = await this.json(`${this.base(L.host)}/${encodeURIComponent(L.user)}/live_media?fields=id&${tp}`).catch(() => null);
      if (d && !(d.data || []).some((x) => x.id === L.id)) return this._ended();
    }
    let d;
    try {
      d = await this.json(`${this.base(L.host)}/${L.id}/comments?fields=id,text,username,timestamp&limit=50&${tp}`);
    } catch (e) {
      if (/does not exist|Unsupported get request/i.test(e.message)) return this._ended();
      throw e;
    }
    const msgs = (d.data || []).map((c) => ({
      id: 'ig:' + c.id, platform: 'instagram', author: c.username || 'Instagram-Nutzer', text: c.text || '', ts: Date.parse(c.timestamp) || Date.now()
    })).sort((a, b) => a.ts - b.ts);
    this.pushBatch(msgs, L.first);
    L.first = false;
    return 3000;
  }
}

module.exports = { FacebookChat, InstagramChat, GRAPH_VERSION };
