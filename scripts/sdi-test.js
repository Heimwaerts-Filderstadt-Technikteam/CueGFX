#!/usr/bin/env node
'use strict';
/* Tests: SDI-Ausgang mit anderen Programmen teilen (nachgebildetes DeckLink-Gerät) */
const path = require('path');
process.env.CUEGFX_DECKLINK_ADDON = path.join(__dirname, 'fixtures', 'fake-decklink.js');
const { DeckLinkManager } = require(path.join(__dirname, '..', 'src', 'decklink', 'manager.js'));
const { CueServer } = require(path.join(__dirname, '..', 'src', 'server', 'index.js'));
const fs = require('fs'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FDL = global.__fakeDL || (require(process.env.CUEGFX_DECKLINK_ADDON), global.__fakeDL);
class FakeWin { constructor() { this.webContents = { on() {}, setAudioMuted() {}, setFrameRate() {}, invalidate() {}, capturePage: async () => null }; this._d = false; } setContentSize() {} loadURL() {} isDestroyed() { return this._d; } destroy() { this._d = true; } }
let ok = 0, bad = 0; const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? ok++ : bad++; };
(async () => {
  const dir = path.join(require('os').tmpdir(), 'cuegfx-sditest-' + process.pid); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/config.json', '{"audiencePort":0}');
  let s;
  const dl = new DeckLinkManager({ BrowserWindow: FakeWin, getPort: () => 47980, getProject: () => s.project, log: () => {} });
  s = new CueServer({ dataDir: dir, port: 47980, hooks: { desktop: true, get decklink() { return dl; } } }); await s.start();
  await dl.configure([{ id: 'dlA', deviceKey: 'dev0', modeId: 'Hp50', output: '2', share: true }]);
  check(dl.running.has('dlA') && FDL.holder, 'Geteilter Ausgang läuft, Gerät von CueGFX belegt');
  const g = s.exec('graphic.add', { type: 'speakertimer', name: 'Redezeit' }); s.exec('graphic.update', { id: g.id, outputs: ['2'] }); s.exec('graphic.show', { id: g.id });
  let err = ''; try { s.exec('sdi.release', {}); } catch (e) { err = e.message + ' (' + e.code + ')'; }
  check(/Sendung.*Redezeit/.test(err) && /409/.test(err), 'Schutz: Freigeben verweigert, solange etwas auf Sendung ist → ' + err);
  s.exec('sdi.release', { force: true });
  check(dl.share.released && !FDL.holder && !dl.running.has('dlA'), 'Erzwungene Freigabe: Gerät frei');
  check(dl.info().status.dlA.released === true, 'Status zeigt „freigegeben“');
  FDL.busyByOther = true; // ProPresenter übernimmt das Gerät
  s.exec('sdi.claim', {});
  check(!dl.running.has('dlA') && dl.info().share.retrying && /belegt/.test(dl.info().status.dlA.error), 'Zurückholen, während ProPresenter belegt → wiederholt: ' + dl.info().status.dlA.error);
  await wait(1000); FDL.busyByOther = false; await wait(2000);
  check(dl.running.has('dlA') && FDL.holder && !dl.info().share.retrying, 'Sobald ProPresenter freigibt, holt CueGFX das Gerät automatisch');
  s.exec('graphic.hide', { id: g.id });
  const r = s.exec('sdi.toggle', {}); check(r.released === true, 'Umschalten: freigegeben (nichts mehr auf Sendung)');
  await dl.configure([{ id: 'dlA', deviceKey: 'dev0', modeId: 'Hp50', output: '2', share: true }, { id: 'dlB', deviceKey: 'dev1', modeId: 'Hp50', output: '1', share: false, enabled: false }]);
  check(!dl.running.has('dlA'), 'Neu übernehmen der Konfiguration belegt freigegebene Ausgänge nicht wieder');
  s.exec('sdi.toggle', {}); check(dl.running.has('dlA'), 'Umschalten: zurückgeholt');
  const cfg = s.exec('sdi.settings', { auto: true, delay: 3, protect: false }); check(cfg.auto && cfg.delay === 3 && !cfg.protect && s.store.config.sdiShare.auto, 'Automatik-Einstellungen gespeichert');
  const hw = JSON.parse(s._hwJson || '{}'); s._pushHardware(); check(s.sdiShareCfg().delay === 3, 'Einstellungen im Hardware-Status');
  // REST
  const rr = await (await fetch('http://127.0.0.1:47980/api/decklink/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"release"}' })).json();
  check(rr.ok && rr.released && dl.share.by === 'manual', 'REST /api/decklink/share');
  await dl.configure([{ id: 'dlA', deviceKey: 'dev0', modeId: 'Hp50', output: '2', share: false }]);
  check(dl.running.has('dlA') || FDL.holder, 'Ausgang ohne „Teilen“ startet trotz Freigabe-Status');
  let e2 = ''; try { s.exec('sdi.release', {}); } catch (e) { e2 = e.message; } check(/Kein DeckLink-Ausgang/.test(e2), 'Ohne geteilte Ausgänge: klare Meldung');
  dl.stopAll(); await s.stop(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen · Gerätelog: ${FDL.log.join(' → ')}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
