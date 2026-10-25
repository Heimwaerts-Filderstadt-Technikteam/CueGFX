#!/usr/bin/env node
'use strict';
/* Schnelltest von Server, API, Export/Import und WebSocket – ohne Desktop-Oberfläche. Aufruf: npm test */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { CueServer } = require('../src/server/index');

let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✔ ' + msg); } else { failed++; console.log('  ✖ ' + msg); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuegfx-test-'));
  const server = new CueServer({ dataDir: dir, port: 0 + 4590 + Math.floor(Math.random() * 300), host: '127.0.0.1' });
  await server.start();
  const base = `http://127.0.0.1:${server.port}`;
  const get = async (p, opts) => { const r = await fetch(base + p, opts); const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
  const cmd = (c, args) => get('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: c, args }) });
  console.log(`CueGFX-Test auf ${base}`);

  console.log('Seiten');
  for (const p of ['/control', '/output/1', '/output/preview', '/audience', '/shared/graphic-types.js', '/output/renderers.js']) ok((await get(p)).status === 200, `GET ${p}`);
  ok((await get('/output/../../package.json')).status === 404, 'Pfad-Traversal wird abgewiesen');

  console.log('Grafiken & Befehle');
  const list = (await get('/api/graphics')).body;
  ok(Array.isArray(list) && list.length >= 5, `Demo-Projekt mit ${list.length} Grafiken`);
  const add = (await cmd('graphic.add', { type: 'lowerthird', name: 'Test LT' })).body;
  ok(add.ok && add.result.id, 'Grafik anlegen');
  await get('/api/graphics/Test%20LT/show');
  ok(server.project.graphics.find((g) => g.name === 'Test LT').live === true, 'Einblenden per Name (GET)');
  await get('/api/graphics/Test%20LT/update?name=Erika&title=Regie');
  const lt = server.project.graphics.find((g) => g.name === 'Test LT');
  ok(lt.data.name === 'Erika' && lt.data.title === 'Regie', 'Felder per URL ändern');
  await get('/api/graphics/Test%20LT/toggle');
  ok(lt.live === false, 'Umschalten');
  await get(`/api/graphics/${lt.id}/preview`);
  await get('/api/take');
  ok(lt.live === true && lt.preview === false, 'Vorschau + TAKE');
  await get('/api/hide-all');
  ok(!server.project.graphics.some((g) => g.live), 'Alles ausblenden');

  const timerId = (await cmd('graphic.add', { type: 'timer' })).body.result.id;
  await get(`/api/graphics/${timerId}/timer-set?seconds=1:30`);
  await get(`/api/graphics/${timerId}/timer-start`);
  const t = server.project.graphics.find((g) => g.id === timerId).data.timer;
  ok(t.duration === 90 && t.running, 'Timer setzen (mm:ss) und starten');
  await get(`/api/graphics/${timerId}/timer-add?seconds=30`);
  ok(t.duration === 120, 'Timer +30 s');

  const scoreId = (await cmd('graphic.add', { type: 'score' })).body.result.id;
  await get(`/api/graphics/${scoreId}/score?team=b&delta=3`);
  ok(server.project.graphics.find((g) => g.id === scoreId).data.scoreB === 3, 'Spielstand +3');

  const lyId = (await cmd('graphic.add', { type: 'lyrics' })).body.result.id;
  await get(`/api/graphics/${lyId}/next`);
  await get(`/api/graphics/${lyId}/next`);
  ok(server.project.graphics.find((g) => g.id === lyId).data.index === 1, 'Songtext weiter (an letzter Folie begrenzt)');

  console.log('Variablen');
  await get('/api/variables/gast?value=Dr.%20Test');
  ok((await get('/api/variables')).body.gast === 'Dr. Test', 'Variable setzen und lesen');
  await get('/api/lists/gaeste/next');
  ok(server.variables().gaeste === 'Gast 2', 'Liste weiterschalten');

  console.log('Medien');
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082', 'hex');
  const up = await get('/api/media?name=test%20bild.png', { method: 'PUT', body: png });
  ok(up.body.ok && up.body.kind === 'image', 'Upload');
  const rng = await get('/media/' + encodeURIComponent(up.body.name), { headers: { Range: 'bytes=0-7' } });
  ok(rng.status === 206 && rng.body.length === 8, 'Range-Anfrage (für Video-Seeking)');
  await cmd('graphic.update', { id: lt.id, data: { logo: up.body.name } });

  console.log('QR');
  const qr = await get('/api/qr.svg?text=' + encodeURIComponent('https://example.com'));
  ok(qr.status === 200 && qr.body.toString().startsWith('<svg'), 'QR-Code als SVG');

  console.log('Export / Import');
  const exp = await get('/api/export');
  ok(exp.status === 200 && exp.body[0] === 0x50 && exp.body[1] === 0x4b, `Export als ZIP (${Math.round(exp.body.length / 1024)} KB)`);
  fs.rmSync(path.join(dir, 'media', up.body.name));
  const imp = await get('/api/import?name=Importiert', { method: 'POST', body: exp.body });
  ok(imp.body.ok && imp.body.media === 1, 'Import inkl. Mediendatei');
  ok(server.project.name === 'Importiert' && server.project.graphics.length === list.length + 4, 'Importiertes Projekt ist aktiv und vollständig');
  ok(fs.existsSync(path.join(dir, 'media', up.body.name)), 'Mediendatei wiederhergestellt');

  if (typeof WebSocket === 'function') {
    console.log('WebSocket');
    const wsUrl = base.replace('http', 'ws') + '/ws';
    const open = (role) => new Promise((res, rej) => { const w = new WebSocket(`${wsUrl}?role=${role}`); const msgs = []; w.onmessage = (e) => msgs.push(JSON.parse(e.data)); w.onopen = () => res({ w, msgs }); w.onerror = rej; });
    const ctl = await open('control');
    await new Promise((r) => setTimeout(r, 200));
    ok(ctl.msgs.some((m) => m.t === 'state' && m.project), 'Steuerung erhält Status');
    const aud = await open('audience');
    await new Promise((r) => setTimeout(r, 200));
    const send = (c, m) => new Promise((res) => { const id = Math.random(); c.w.addEventListener('message', function f(e) { const x = JSON.parse(e.data); if (x.t === 'res' && x.id === id) { c.w.removeEventListener('message', f); res(x); } }); c.w.send(JSON.stringify(Object.assign({ t: 'cmd', id }, m))); });
    const denied = await send(aud, { cmd: 'graphic.show', args: { id: lt.id } });
    ok(denied.ok === false, 'Publikum darf keine Grafiken steuern');
    await cmd('qa.settings', { moderation: true, blockedWords: 'idiot\nwerbung*', blockedAction: 'moderate' });
    const q = await send(aud, { cmd: 'qa.submit', args: { text: 'Testfrage?', author: 'Tester' } });
    ok(q.ok && q.result.status === 'pending' && server.project.questions.length === 1, 'Frage landet zur Prüfung (Moderation)');
    const flood = await send(aud, { cmd: 'qa.submit', args: { text: 'Noch eine', author: 'Tester' } });
    ok(flood.ok === false, 'Schutz gegen Fluten');
    const q1 = server.project.questions[0];
    await cmd('qa.approve', { id: q1.id });
    ok(q1.status === 'live', 'Freigeben');
    const lk = await send(aud, { cmd: 'qa.like', args: { id: q1.id, voter: 'gefälscht' } });
    ok(lk.ok && q1.likes === 1 && q1.likedBy[0] !== 'gefälscht', 'Like zählt mit Geräte-Kennung (nicht frei wählbar)');
    await cmd('qa.settings', { moderation: false });
    const aud2 = await open('audience');
    const q2 = await send(aud2, { cmd: 'qa.submit', args: { text: 'Du 1d10t, kauft Werbungsprodukte', author: 'Troll' } });
    const troll = server.project.questions.find((x) => x.author === 'Troll');
    ok(q2.ok && troll.status === 'pending' && troll.flagged.length === 2, 'Sperrwörter halten Frage trotz abgeschalteter Moderation zurück');
    await cmd('qa.settings', { blockedAction: 'censor' });
    const aud3 = await open('audience');
    await send(aud3, { cmd: 'qa.submit', args: { text: 'Ein Idiot war hier', author: 'X' } });
    ok(server.project.questions.some((x) => x.text === 'Ein ***** war hier' && x.status === 'live'), 'Sperrwörter zensieren');
    await cmd('qa.approveAll');
    ok(troll.status === 'pending', '„Alle freigeben“ lässt Sperrwort-Treffer stehen');
    await cmd('qa.active', { id: q1.id });
    ok(q1.active, 'Frage aktiv markieren');
    const nx = (await cmd('qa.activeNext')).body.result;
    ok(q1.resolved && !q1.active && nx.id && server.project.questions.find((x) => x.id === nx.id).active, 'Nächste Frage: alte gelöst, neue aktiv');
    const pollId = (await cmd('poll.create', { question: 'Test?', options: ['A', 'B'] })).body.result.id;
    await cmd('poll.update', { id: pollId, open: true });
    const poll = server.project.polls.find((p) => p.id === pollId);
    const v = await send(aud, { cmd: 'poll.vote', args: { pollId, optionId: poll.options[0].id } });
    ok(v.ok && poll.options[0].votes === 1, 'Abstimmen');
    const wc = (await cmd('poll.create', { question: 'Wort?', type: 'wordcloud' })).body.result.id;
    await cmd('poll.update', { id: wc, open: true });
    await new Promise((r) => setTimeout(r, 300));
    await send(aud, { cmd: 'poll.vote', args: { pollId: wc, words: ['Super', 'Idiot'] } });
    const wcp = server.project.polls.find((p) => p.id === wc);
    ok(Object.keys(wcp.words).length === 1 && wcp.words.super.count === 1, 'Wortwolke filtert Sperrwörter');
    const rt = (await cmd('poll.create', { question: 'Note?', type: 'rating' })).body.result.id;
    await cmd('poll.update', { id: rt, open: true });
    await new Promise((r) => setTimeout(r, 300));
    await send(aud2, { cmd: 'poll.vote', args: { pollId: rt, value: 4 } });
    ok(server.project.polls.find((p) => p.id === rt).ratings[3] === 1, 'Bewertung');
    const r = await send(ctl, { cmd: 'qa.show', args: { id: q1.id } });
    ok(r.ok && server.project.graphics.find((g) => g.id === r.result.graphicId).live && q1.active, 'Frage einzeln auf Sendung');
    aud2.w.close(); aud3.w.close();
    ctl.w.close(); aud.w.close();
  } else console.log('  (WebSocket-Test übersprungen – Node 22 oder neuer nötig)');

  ok((await get('/api/cmd', { method: 'POST' })).status === 400, '/api/cmd ohne Befehl → 400 statt Absturz');
  server.exec('audio.out', { output: '2', deviceId: 'abc', label: 'USB Audio' });
  ok(server.audioOut().output === '2' && server.audioOut().label === 'USB Audio' && server._statePayload().info.audioOut.deviceId === 'abc', 'Ton-Ausgabe: Ausgang und Gerät gespeichert');

  // Öffentlicher Port nur für die Publikumsseite
  server.store.config.audiencePort = 47000 + Math.floor(Math.random() * 2000);
  await server._startPublic();
  const pub = `http://127.0.0.1:${server.store.config.audiencePort}`;
  const pst = async (u) => (await fetch(pub + u)).status;
  ok(server.pubStatus === 'läuft' && (await (await fetch(pub + '/')).text()).includes('id="ask"'), 'Öffentlicher Port zeigt die Publikumsseite');
  ok(await pst('/control') === 404 && await pst('/api/state') === 404 && await pst('/api/graphics') === 404 && await pst('/output/1') === 404, 'Öffentlicher Port sperrt Steuerung, API und Ausgänge');
  server.exec('audience.access', { publicUrl: 'fragen.example.org' });
  ok(server._audienceUrl() === 'https://fragen.example.org', 'Eigene Domain wird für QR-Codes verwendet');

  // Installierte Schriften
  for (let i = 0; i < 50 && !server.sysFonts.ready; i++) await new Promise((r) => setTimeout(r, 100));
  const sf = (await get('/api/system-fonts')).body;
  ok(sf.ready && Array.isArray(sf.families), `Schriftsuche: ${sf.families.length} installierte Familien`);
  if (sf.families.length) {
    const fam = sf.families[0].family;
    server.exec('theme.update', { theme: { headingFont: `"${fam}", sans-serif` } });
    const css = (await get('/api/fonts.css')).body.toString();
    ok(css.includes(`font-family:"${fam}"`), `Verwendete Systemschrift „${fam}“ steht in fonts.css`);
  }
  ok((await get('/api/sysfont/999999.ttf')).status === 404, 'Nur gescannte Schriftdateien werden ausgeliefert');

  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
