'use strict';
/*
 * YouTube-Live-Chat.
 *  - Ohne Schlüssel: liest den öffentlichen Chat wie die Chat-Ansicht im Browser (kein Login, kein Kontingent).
 *  - Mit API-Schlüssel: offizielle YouTube Data API v3 (Tageskontingent beachten).
 * Erkennt automatisch, wann der Kanal live geht, und verbindet sich neu, wenn der Stream endet.
 */
const { Connector } = require('./base');

const YT = 'https://www.youtube.com';
const API = 'https://www.googleapis.com/youtube/v3';
const COOKIE = 'SOCS=CAI; CONSENT=YES+cb.20250101-00-p0.de+FX+000';

/* Eingabe → { videoId } oder { url } für die /live-Seite */
function parseTarget(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = s.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  if (m) return { videoId: m[1] };
  if (/^[\w-]{11}$/.test(s) && !s.startsWith('@') && !s.startsWith('UC')) return { videoId: s };
  m = s.match(/youtube\.com\/(@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/);
  if (m) return { url: `${YT}/${m[1]}/live` };
  if (s.startsWith('@')) return { url: `${YT}/${s}/live` };
  if (/^UC[\w-]{20,}$/.test(s)) return { url: `${YT}/channel/${s}/live` };
  return { url: `${YT}/@${s.replace(/^@/, '')}/live` };
}

function runsToText(msg) {
  if (!msg) return '';
  if (msg.simpleText) return msg.simpleText;
  return (msg.runs || []).map((r) => {
    if (r.text) return r.text;
    if (r.emoji) return r.emoji.isCustomEmoji ? ((r.emoji.shortcuts || [])[0] || '') : (r.emoji.emojiId || (r.emoji.shortcuts || [])[0] || '');
    return '';
  }).join('');
}

function lastThumb(t) { const a = t && t.thumbnails; return a && a.length ? a[a.length - 1].url : ''; }

/* Aktionen aus der Chat-Antwort in Nachrichten wandeln (exportiert für Tests) */
function parseActions(actions) {
  const out = [];
  for (const a of actions || []) {
    const item = a && a.addChatItemAction && a.addChatItemAction.item;
    if (!item) continue;
    const r = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer || item.liveChatMembershipItemRenderer || item.liveChatPaidStickerRenderer;
    if (!r || !r.id) continue;
    const badges = (r.authorBadges || []).map((b) => b.liveChatAuthorBadgeRenderer && b.liveChatAuthorBadgeRenderer.tooltip).filter(Boolean).join(', ');
    let text = runsToText(r.message);
    if (!text && item.liveChatMembershipItemRenderer) text = runsToText(r.headerSubtext) || 'Neues Mitglied';
    if (!text && item.liveChatPaidStickerRenderer) text = 'Super Sticker';
    out.push({
      id: 'yt:' + r.id,
      platform: 'youtube',
      author: runsToText(r.authorName).replace(/^@/, ''),
      text,
      avatar: lastThumb(r.authorPhoto),
      amount: r.purchaseAmountText ? runsToText(r.purchaseAmountText) : '',
      badges,
      ts: r.timestampUsec ? Math.round(Number(r.timestampUsec) / 1000) : Date.now()
    });
  }
  return out;
}

function nextContinuation(lc) {
  const c = ((lc && lc.continuations) || [])[0] || {};
  const d = c.invalidationContinuationData || c.timedContinuationData || c.reloadContinuationData || null;
  return d ? { token: d.continuation, timeout: Number(d.timeoutMs) || 5000 } : null;
}

class YouTubeChat extends Connector {
  constructor(cfg, opts) {
    super(cfg, opts);
    this.yt = (opts && opts.youtubeBase) || YT;
    this.api = (opts && opts.apiBase) || API;
    this.onStop = () => { this.chat = null; };
  }

  async tick() {
    if (!this.chat) return this._find();
    return this.chat.mode === 'api' ? this._pollApi() : this._pollWeb();
  }

  async _page(url) {
    const res = await this.http(url.replace(YT, this.yt), { headers: { cookie: COOKIE } });
    if (!res.ok) throw new Error(`YouTube antwortet mit ${res.status}`);
    return res.text();
  }

  async _find() {
    const target = parseTarget(this.cfg.channel);
    if (!target) throw new Error('Kein Kanal oder Video angegeben');
    let videoId = target.videoId, title = '';
    if (!videoId) {
      const html = await this._page(target.url);
      const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
      const live = /"isLiveNow":true|"isLive":true/.test(html);
      if (!canon || !live) { this.setStatus('wartet auf Livestream…', 'waiting'); return 45000; }
      videoId = canon[1];
      const t = html.match(/<meta name="title" content="([^"]*)"/); title = t ? t[1] : '';
    }

    if (this.cfg.apiKey) {
      const d = await this.json(`${this.api}/videos?part=liveStreamingDetails,snippet&id=${videoId}&key=${encodeURIComponent(this.cfg.apiKey)}`);
      const v = (d.items || [])[0];
      const chatId = v && v.liveStreamingDetails && v.liveStreamingDetails.activeLiveChatId;
      if (!chatId) { this.setStatus('wartet auf Livestream…', 'waiting'); return 45000; }
      this.chat = { mode: 'api', videoId, chatId, page: '', first: true };
      title = (v.snippet && v.snippet.title) || title;
    } else {
      const html = await this._page(`${YT}/live_chat?is_popout=1&v=${videoId}`);
      const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
      const ver = (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || html.match(/"clientVersion":"([\d.]+)"/) || [])[1];
      const cont = (html.match(/"continuation":"([^"]+)"/) || [])[1];
      if (!cont) { this.setStatus('wartet auf Livestream… (Chat nicht verfügbar)', 'waiting'); return 45000; }
      this.chat = { mode: 'web', videoId, key: key || '', ver: ver || '2.20250101.00.00', cont, first: true };
    }
    this.setStatus(`live${title ? ': ' + title : ''} (${videoId})${this.chat.mode === 'api' ? ' · API' : ''}`, 'live');
    return 0;
  }

  _ended(reason) {
    this.chat = null;
    this.setStatus(reason || 'Livestream beendet – wartet auf den nächsten…', 'waiting');
    return 30000;
  }

  async _pollWeb() {
    const c = this.chat;
    const url = `${this.yt}/youtubei/v1/live_chat/get_live_chat?prettyPrint=false${c.key ? '&key=' + c.key : ''}`;
    let d;
    try {
      d = await this.json(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie: COOKIE }, body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'de', gl: 'DE' } }, continuation: c.cont }) });
    } catch (e) {
      if (e.status === 404 || e.status === 400) return this._ended();
      throw e;
    }
    const lc = d.continuationContents && d.continuationContents.liveChatContinuation;
    if (!lc) return this._ended();
    this.pushBatch(parseActions(lc.actions), c.first);
    c.first = false;
    const next = nextContinuation(lc);
    if (!next || !next.token) return this._ended();
    c.cont = next.token;
    return Math.max(1500, Math.min(10000, next.timeout));
  }

  async _pollApi() {
    const c = this.chat;
    let d;
    try {
      d = await this.json(`${this.api}/liveChat/messages?liveChatId=${encodeURIComponent(c.chatId)}&part=snippet,authorDetails&maxResults=200${c.page ? '&pageToken=' + c.page : ''}&key=${encodeURIComponent(this.cfg.apiKey)}`);
    } catch (e) {
      if (/liveChatEnded|liveChatNotFound|forbidden/i.test(e.message)) return this._ended();
      if (/quota/i.test(e.message)) { this.chat = null; this.setStatus('API-Tageskontingent aufgebraucht – Schlüssel entfernen oder morgen erneut', 'error'); return 600000; }
      throw e;
    }
    const msgs = (d.items || []).map((it) => {
      const s = it.snippet || {}, a = it.authorDetails || {};
      const sc = s.superChatDetails || s.superStickerDetails;
      const badges = [a.isChatOwner && 'Inhaber', a.isChatModerator && 'Moderator', a.isChatSponsor && 'Mitglied'].filter(Boolean).join(', ');
      return { id: 'yt:' + it.id, platform: 'youtube', author: a.displayName, avatar: a.profileImageUrl, text: (sc && sc.userComment) || s.displayMessage || '', amount: sc ? sc.amountDisplayString : '', badges, ts: Date.parse(s.publishedAt) || Date.now() };
    });
    this.pushBatch(msgs, c.first);
    c.first = false;
    c.page = d.nextPageToken || c.page;
    if (d.offlineAt) return this._ended();
    return Math.max(2000, Math.min(20000, Number(d.pollingIntervalMillis) || 5000));
  }
}

module.exports = { YouTubeChat, parseTarget, parseActions, runsToText };
