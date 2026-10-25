#!/usr/bin/env node
'use strict';
/* Tests der Chat-Quellen gegen nachgebaute YouTube-, Meta- und Social-Stream-Ninja-Server */
const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { WsServer } = require(ROOT + '/src/server/websocket.js');
const { CueServer } = require(ROOT + '/src/server/index.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0; const check = (c, m) => { if (c) { ok++; console.log('  ✓', m); } else { bad++; console.log('  ✗', m); } };

/* ---- Mock: YouTube, Graph API, Social Stream Ninja ---- */
let fbComments = [], igComments = [], ytCalls = 0, igLive = true;
const ytAction = (id, name, runs, extra) => ({ addChatItemAction: { item: { [extra ? 'liveChatPaidMessageRenderer' : 'liveChatTextMessageRenderer']: Object.assign({ id, authorName: { simpleText: '@' + name }, message: { runs }, authorPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/a=s32' }, { url: 'https://yt3.ggpht.com/a=s64' }] }, timestampUsec: String(Date.now() * 1000), authorBadges: [{ liveChatAuthorBadgeRenderer: { tooltip: 'Moderator' } }] }, extra || {}) } } });
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type) => { res.writeHead(code, { 'content-type': type || 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  // YouTube
  if (u.pathname === '/@gemeinde/live') return send(200, '<html><link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk"><meta name="title" content="Gottesdienst live">"isLiveNow":true</html>', 'text/html');
  if (u.pathname === '/@offline/live') return send(200, '<html><link rel="canonical" href="https://www.youtube.com/@offline"></html>', 'text/html');
  if (u.pathname === '/live_chat') return send(200, '<script>ytcfg.set({"INNERTUBE_API_KEY":"KEY123","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20251020.01.00"})</script><script>var ytInitialData = {"continuation":"C0"};</script>', 'text/html');
  if (u.pathname === '/youtubei/v1/live_chat/get_live_chat') {
    let body = ''; req.on('data', (d) => body += d); req.on('end', () => {
      ytCalls++;
      const b = JSON.parse(body);
      if (u.searchParams.get('key') !== 'KEY123' || b.context.client.clientVersion !== '2.20251020.01.00') return send(400, { error: 'bad key' });
      if (b.continuation === 'C0') return send(200, { continuationContents: { liveChatContinuation: { actions: Array.from({ length: 25 }, (_, i) => ytAction('old' + i, 'alt' + i, [{ text: 'Alt ' + i }])), continuations: [{ invalidationContinuationData: { continuation: 'C1', timeoutMs: 1000 } }] } } });
      if (b.continuation === 'C1') return send(200, { continuationContents: { liveChatContinuation: { actions: [ytAction('n1', 'anna', [{ text: 'Hallo aus ' }, { emoji: { emojiId: '🇩🇪', shortcuts: [':de:'] } }, { text: ' Stuttgart' }]), ytAction('n2', 'ben', [{ text: 'Danke!' }], { purchaseAmountText: { simpleText: '5,00 €' } })], continuations: [{ timedContinuationData: { continuation: 'C2', timeoutMs: 1000 } }] } } });
      return send(200, { continuationContents: { liveChatContinuation: { actions: [] } } }); // Stream beendet
    }); return;
  }
  // Graph API
  const tok = u.searchParams.get('access_token');
  if (u.pathname.startsWith('/graph/')) {
    if (tok !== 'GOODTOKEN' && tok !== 'IGTOKEN') return send(400, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException' } });
    const p = u.pathname.slice(7);
    if (p === '12345/live_videos') return send(200, { data: [{ id: 'v1', title: 'Gottesdienst', status: 'LIVE' }] });
    if (p === 'v1/comments') return send(200, { data: fbComments.slice().reverse() });
    if (p === 'v1') return send(200, { status: 'LIVE' });
    if (p === 'me/live_media') return send(200, { data: igLive ? [{ id: 'm1', media_product_type: 'LIVE' }] : [] });
    if (p === 'm1/comments') return send(200, { data: igComments });
  }
  send(404, { error: { message: 'Unsupported get request' } });
});
const ssnWs = new WsServer(mock, { path: '/ssn' });
let ssnJoin = null;
ssnWs.on('connection', (c) => c.on('message', (m) => {
  ssnJoin = JSON.parse(m);
  setTimeout(() => {
    c.send(JSON.stringify({ overlayNinja: { id: 77, type: 'tiktok', chatname: 'tiktok_user', chatmessage: 'Hi <img src="x" alt="😀"> &amp; Grüße', chatimg: 'https://p16.tiktokcdn.com/a.jpg', timestamp: Date.now() } }));
    c.send(JSON.stringify({ overlayNinja: { id: 78, type: 'tiktok', chatname: 'fan', chatmessage: '', event: 'joined' } }));
    c.send(JSON.stringify({ overlayNinja: { id: 79, type: 'tiktok', chatname: 'gönner', chatmessage: 'Rose', hasDonation: '1 Rose', event: 'gift' } }));
    c.send(JSON.stringify({ id: 80, type: 'kick', chatname: 'kicker', chatmessage: 'kick msg' }));
  }, 200);
}));

(async () => {
  await new Promise((r) => mock.listen(4931, r));
  const B = 'http://127.0.0.1:4931';
  const fs = require('fs'); const dir = path.join(require('os').tmpdir(), 'cuegfx-chattest-' + process.pid); fs.rmSync(dir, { recursive: true, force: true });
  const srv = new CueServer({ dataDir: dir, port: 4932, chatOpts: { youtubeBase: B, graphBase: B + '/graph', ssnServer: 'ws://127.0.0.1:4931/ssn' } });
  await srv.start();
  const msgs = []; srv.on('chat', (m) => msgs.push(m));
  const ex = (c, a) => srv.exec(c, a || {});

  console.log('YouTube (ohne Schlüssel)');
  const yt = ex('chat.source.add', { preset: 'youtube', values: { channel: 'https://www.youtube.com/@gemeinde' }, enabled: true }).id;
  await wait(3500);
  const ytm = msgs.filter((m) => m.platform === 'youtube');
  check(ytm.length === 17, `Rückblick auf 15 + 2 neue Nachrichten (${ytm.length})`);
  const anna = ytm.find((m) => m.author === 'anna');
  check(anna && anna.text === 'Hallo aus 🇩🇪 Stuttgart', 'Text mit Emoji: ' + (anna && anna.text));
  check(anna && anna.avatar.endsWith('s64') && anna.badges === 'Moderator', 'Avatar (größtes Bild) + Abzeichen');
  const ben = ytm.find((m) => m.author === 'ben');
  check(ben && ben.amount === '5,00 €', 'Super Chat mit Betrag');
  let st = srv.chat.list().find((s) => s.id === yt);
  check(/wartet|beendet/.test(st.status) && st.state === 'waiting', 'Stream-Ende erkannt → wartet: ' + st.status);

  const off = ex('chat.source.add', { preset: 'youtube', values: { channel: '@offline' }, enabled: true }).id;
  await wait(500);
  st = srv.chat.list().find((s) => s.id === off);
  check(st.status === 'wartet auf Livestream…', 'Offline-Kanal wartet: ' + st.status);

  console.log('Facebook');
  fbComments = [{ id: 'c1', message: 'Erster', from: { name: 'Clara', picture: { data: { url: 'https://fb/c.jpg' } } }, created_time: new Date().toISOString() }];
  const fb = ex('chat.source.add', { preset: 'facebook', values: { pageId: '12345', token: 'GOODTOKEN' }, enabled: true }).id;
  await wait(600);
  fbComments.push({ id: 'c2', message: 'Zweiter', created_time: new Date().toISOString() });
  await wait(3400);
  const fbm = msgs.filter((m) => m.platform === 'facebook');
  check(fbm.length === 2 && fbm[0].text === 'Erster' && fbm[1].author === 'Facebook-Nutzer', `Kommentare in Reihenfolge, ohne Doppelte (${fbm.map((m) => m.text).join(', ')})`);
  check(fbm[0].avatar === 'https://fb/c.jpg', 'Facebook-Avatar');
  const fbBad = ex('chat.source.add', { preset: 'facebook', values: { pageId: '12345', token: 'FALSCH' }, enabled: true }).id;
  await wait(500);
  st = srv.chat.list().find((s) => s.id === fbBad);
  check(st.state === 'error' && /ungültig/i.test(st.status), 'Falscher Token → verständlicher Fehler: ' + st.status);

  console.log('Instagram');
  igComments = [{ id: 'i2', text: 'Neuer', username: 'insta_b', timestamp: new Date(Date.now()).toISOString() }, { id: 'i1', text: 'Älter', username: 'insta_a', timestamp: new Date(Date.now() - 5000).toISOString() }];
  const ig = ex('chat.source.add', { preset: 'instagram', values: { token: 'IGTOKEN' }, enabled: true }).id;
  await wait(800);
  const igm = msgs.filter((m) => m.platform === 'instagram');
  check(igm.length === 2 && igm[0].text === 'Älter', 'Instagram-Kommentare chronologisch: ' + igm.map((m) => m.text).join(', '));
  const igFb = ex('chat.source.add', { preset: 'instagram', values: { token: 'GOODTOKEN' }, enabled: true }).id;
  await wait(400);
  st = srv.chat.list().find((s) => s.id === igFb);
  check(/Konto-ID fehlt/.test(st.status), 'Facebook-Token ohne Konto-ID → Hinweis');

  console.log('TikTok über Social Stream Ninja');
  const tt = ex('chat.source.add', { preset: 'tiktok', values: { session: 'abc123' }, enabled: true }).id;
  await wait(900);
  const ttm = msgs.filter((m) => m.platform === 'tiktok');
  check(ssnJoin && ssnJoin.join === 'abc123' && ssnJoin.in === 4, 'Sitzung beigetreten: ' + JSON.stringify(ssnJoin));
  check(ttm.length === 2, `2 TikTok-Nachrichten (Beitritt übersprungen, Geschenk behalten): ${ttm.length}`);
  check(ttm[0] && ttm[0].text === 'Hi 😀 & Grüße', 'HTML bereinigt: ' + (ttm[0] && ttm[0].text));
  check(ttm[1] && ttm[1].amount === '1 Rose', 'Geschenk mit Betrag');
  check(!msgs.some((m) => m.platform === 'kick'), 'Plattform-Filter „tiktok“ blendet Kick aus');
  st = srv.chat.list().find((s) => s.id === tt);
  check(st.state === 'live' && st.name === 'TikTok', 'Status live, Name TikTok: ' + st.status);

  console.log('Verwaltung');
  const list = srv.chat.list();
  check(list.find((s) => s.id === fb).values.token === '••••OKEN', 'Token in der Oberfläche maskiert');
  ex('chat.source.update', { id: fb, values: { token: '••••OKEN', pageId: '12345' } });
  check(srv.store.config.chatSources.find((c) => c.id === fb).values.token === 'GOODTOKEN', 'Maskierter Wert überschreibt Token nicht');
  ex('chat.source.update', { id: tt, enabled: false });
  await wait(100);
  check(srv.chat.list().find((s) => s.id === tt).state === 'off', 'Quelle deaktiviert');
  const show = ex('chat.show', { msgId: ben.id, live: false });
  const g = srv.project.graphics.find((x) => x.id === show.graphicId);
  check(g && g.data.platform === 'youtube' && g.data.message === '💰 5,00 € · Danke!' && g.data.avatar.endsWith('s64'), 'Super Chat in Grafik: ' + (g && g.data.message));
  const tw = ex('chat.connect', { channel: 'meinkanal' }).sourceId;
  check(srv.store.config.chatSources.find((c) => c.id === tw).values.channel === 'meinkanal', 'Alter Befehl chat.connect legt Twitch-Quelle an');
  ex('chat.source.remove', { id: igFb });
  check(!srv.chat.list().some((s) => s.id === igFb), 'Quelle entfernt');

  console.log('Neustart: aktivierte Quellen verbinden automatisch');
  await srv.stop();
  const enabledBefore = srv.store.config.chatSources.filter((c) => c.enabled).map((c) => c.id);
  const srv2 = new CueServer({ dataDir: dir, port: 4933, chatOpts: { youtubeBase: B, graphBase: B + '/graph', ssnServer: 'ws://127.0.0.1:4931/ssn' } });
  await srv2.start(); await wait(700);
  const l2 = srv2.chat.list();
  check(l2.length === srv.store.config.chatSources.length && l2.filter((s) => s.enabled).every((s) => s.state !== 'off'), `${enabledBefore.length} aktivierte Quellen wieder verbunden`);
  check(l2.find((s) => s.id === tt).state === 'off', 'Deaktivierte Quelle bleibt aus');
  await srv2.stop();
  mock.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
