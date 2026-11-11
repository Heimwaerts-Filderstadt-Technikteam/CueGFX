#!/usr/bin/env node
'use strict';
/* Tests: DeckLink-Ausgabe mit nachgebildetem Gerät (Start, Stopp, Konfiguration) */
const path = require('path');
process.env.CUEGFX_DECKLINK_ADDON = path.join(__dirname, 'fixtures', 'fake-decklink.js');
const { DeckLinkManager } = require(path.join(__dirname, '..', 'src', 'decklink', 'manager.js'));
const { CueServer } = require(path.join(__dirname, '..', 'src', 'server', 'index.js'));
const fs = require('fs');
const FDL = global.__fakeDL || (require(process.env.CUEGFX_DECKLINK_ADDON), global.__fakeDL);
class FakeWin { constructor() { this.webContents = { on() {}, setAudioMuted() {}, setFrameRate() {}, invalidate() {}, capturePage: async () => null }; this._d = false; } setContentSize() {} loadURL() {} isDestroyed() { return this._d; } destroy() { this._d = true; } }
let ok = 0, bad = 0; const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? ok++ : bad++; };
(async () => {
  const dir = path.join(require('os').tmpdir(), 'cuegfx-dltest-' + process.pid); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // alte Einstellungen der entfernten Funktion „SDI teilen“
  fs.writeFileSync(dir + '/config.json', JSON.stringify({ audiencePort: 0, sdiShare: { auto: true, delay: 5 }, decklinkOutputs: [{ id: 'old', deviceKey: 'dev0', share: true }] }));
  let s;
  const dl = new DeckLinkManager({ BrowserWindow: FakeWin, getPort: () => 47980, getProject: () => s.project, log: () => {} });
  s = new CueServer({ dataDir: dir, port: 47980, hooks: { desktop: true, get decklink() { return dl; } } }); await s.start();
  check(s.store.config.sdiShare === undefined && !('share' in s.store.config.decklinkOutputs[0]), 'Alte Teilen-Einstellungen werden aufgeräumt');
  await dl.configure([{ id: 'dlA', deviceKey: 'dev0', modeId: 'Hp50', output: '2', share: true }]);
  check(dl.running.has('dlA') && FDL.holder, 'Ausgang läuft, Gerät belegt');
  check(!('share' in dl.getConfig()[0]) && !('share' in dl.info()), 'Keine Teilen-Option mehr in Konfiguration und Status');
  for (const c of ['sdi.release', 'sdi.claim', 'sdi.toggle', 'sdi.settings']) {
    let err = ''; try { s.exec(c, {}); } catch (e) { err = e.message; }
    check(/Unbekannt|unknown/i.test(err), `Befehl ${c} entfernt`);
  }
  const r = await fetch('http://127.0.0.1:47980/api/decklink/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"release"}' });
  check(r.status >= 400 && dl.running.has('dlA'), 'REST /api/decklink/share entfernt, Ausgang läuft weiter');
  await dl.configure([{ id: 'dlA', deviceKey: 'dev0', modeId: 'Hp50', output: '2', enabled: false }]);
  check(!dl.running.has('dlA') && !FDL.holder, 'Deaktivieren gibt das Gerät frei');
  await dl.configure([{ id: 'dlA', deviceKey: 'dev0', modeId: 'Hp50', output: '2' }, { id: 'dlB', deviceKey: 'dev0', modeId: 'Hp50', output: '1' }]);
  check(dl.running.has('dlA') && !dl.getConfig()[1].enabled, 'Gleiches Gerät doppelt: zweite Belegung deaktiviert');
  dl.stopAll(); await s.stop(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen · Gerätelog: ${FDL.log.join(' → ')}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
