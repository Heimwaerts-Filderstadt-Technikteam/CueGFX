#!/usr/bin/env node
'use strict';
/* Tests: Bildschirm-Ausgänge – Wiederfinden nach Neustart (neue Bildschirm-ID), Fenster über die ganze Fläche */
const path = require('path');
const { EventEmitter } = require('events');
const { DisplayManager } = require(path.join(__dirname, '..', 'src', 'main', 'displays.js'));
let ok = 0, bad = 0; const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? ok++ : bad++; };
const mkScreen = (list) => Object.assign(new EventEmitter(), { list, getAllDisplays() { return this.list; }, getPrimaryDisplay() { return this.list[0]; },
  getDisplayMatching(b) { const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return this.list.find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height) || this.list[0]; } });
const disp = (id, label, x, w, h) => ({ id, label, bounds: { x, y: 0, width: w, height: h }, size: { width: w, height: h } });
const wins = [];
class FakeWin {
  constructor(o) { this.o = o; this.b = { x: o.x, y: o.y, width: o.width, height: o.height }; this.dead = false; this.top = null; wins.push(this); }
  setBounds(b) { this.b = Object.assign({}, b); } getBounds() { return this.b; } setMenuBarVisibility() {} loadURL(u) { this.url = u; }
  once(ev, fn) { if (ev === 'ready-to-show') this.ready = fn; } on() {} isDestroyed() { return this.dead; } destroy() { this.dead = true; } showInactive() {}
  setAlwaysOnTop(on, lvl) { this.top = lvl; } setVisibleOnAllWorkspaces() {}
}
const built = mkScreen([disp(1, 'Built-in Retina', 0, 1512, 982), disp(77, 'LG HDMI', 1512, 1920, 1080)]);
let saved = null;
const dm1 = new DisplayManager({ BrowserWindow: FakeWin, screen: built, getPort: () => 4001, log: () => {}, onConfigChange: (c) => { saved = c; } });
dm1.configure([{ id: 'd1', enabled: true, displayId: '77', output: '2' }]);
const cfg = dm1.getConfig();
check(cfg[0].displayName === 'LG HDMI' && cfg[0].displaySize === '1920x1080' && cfg[0].displayPrimary === false, 'Merkmale des Bildschirms werden mitgespeichert');
check(wins.length === 1 && wins[0].b.width === 1920 && /\/output\/2$/.test(wins[0].url), 'Ausgangsfenster auf dem HDMI-Bildschirm geöffnet');
if (wins[0].ready) wins[0].ready();
if (process.platform === 'darwin') check(wins[0].top === 'screen-saver' && wins[0].o.enableLargerThanScreen, 'macOS: Fenster über der Menüleiste');
else check(wins[0].o.fullscreen === true, 'Windows/Linux: Vollbild');
// Neustart: macOS hat dem HDMI-Bildschirm eine neue ID gegeben
const after = mkScreen([disp(1, 'Built-in Retina', 0, 1512, 982), disp(91, 'LG HDMI', 1512, 1920, 1080)]);
wins.length = 0;
const dm2 = new DisplayManager({ BrowserWindow: FakeWin, screen: after, getPort: () => 4001, log: () => {}, onConfigChange: (c) => { saved = c; } });
dm2.configure(JSON.parse(JSON.stringify(cfg)));
check(wins.length === 1 && wins[0].b.x === 1512, 'Nach Neustart mit neuer ID: Bildschirm über Name/Auflösung wiedergefunden');
check(dm2.getConfig()[0].displayId === '91' && dm2.getConfig()[0].output === '2', 'Neue ID wird übernommen, Ausgang bleibt');
// Beim Start noch nicht angeschlossen → Eintrag bleibt erhalten, Fenster kommt beim Anstecken
const late = mkScreen([disp(1, 'Built-in Retina', 0, 1512, 982)]);
wins.length = 0;
const dm3 = new DisplayManager({ BrowserWindow: FakeWin, screen: late, getPort: () => 4001, log: () => {} });
dm3.configure(JSON.parse(JSON.stringify(cfg)));
check(wins.length === 0 && dm3.getConfig().length === 1 && dm3.info().outputs[0].connected === false, 'Nicht angeschlossen: Eintrag bleibt gespeichert („nicht angeschlossen“)');
late.list.push(disp(120, 'LG HDMI', 1512, 1920, 1080)); late.emit('display-added');
check(wins.length === 1 && dm3.getConfig()[0].displayId === '120', 'Beim Anstecken öffnet sich der Ausgang automatisch');
// Auflösung ändert sich → Fenster zieht nach
late.list[1] = disp(120, 'LG HDMI', 1512, 1280, 720); late.emit('display-metrics-changed');
check(wins[0].b.width === 1280 && !wins[0].dead, 'Auflösungswechsel: Fenster passt sich an');
// Mac mini + Videomischer: nach Neustart gehört die alte ID des Mischer-Bildschirms dem Hauptbildschirm
const mini1 = mkScreen([disp(5, 'DELL U2720Q', 0, 2560, 1440), disp(6, 'ATEM', 2560, 1920, 1080)]);
wins.length = 0;
const dmA = new DisplayManager({ BrowserWindow: FakeWin, screen: mini1, getPort: () => 4001, log: () => {} });
dmA.configure([{ id: 'm', enabled: true, displayId: '6', output: '1' }]);
const saved2 = dmA.getConfig();
const mini2 = mkScreen([disp(6, 'DELL U2720Q', 0, 2560, 1440), disp(9, 'ATEM', 2560, 1920, 1080)]);
wins.length = 0;
const dmB = new DisplayManager({ BrowserWindow: FakeWin, screen: mini2, getPort: () => 4001, log: () => {} });
dmB.configure(JSON.parse(JSON.stringify(saved2)));
check(wins.length === 1 && wins[0].b.x === 2560 && dmB.getConfig()[0].displayId === '9' && dmB.getConfig()[0].displayName === 'ATEM', 'ID vertauscht (alte Mischer-ID gehört jetzt dem Hauptbildschirm) → trotzdem Mischer-Bildschirm');
// zwei gleichnamige Bildschirme: Größe/Position entscheiden, nie der Hauptbildschirm
const twin1 = mkScreen([disp(1, 'HDMI', 0, 1920, 1080), disp(2, 'HDMI', 1920, 1280, 720)]);
wins.length = 0;
const dmC = new DisplayManager({ BrowserWindow: FakeWin, screen: twin1, getPort: () => 4001, log: () => {} });
dmC.configure([{ id: 't', enabled: true, displayId: '2', output: '1' }]);
const twin2 = mkScreen([disp(3, 'HDMI', 0, 1920, 1080), disp(4, 'HDMI', 1920, 1280, 720)]);
wins.length = 0;
const dmD = new DisplayManager({ BrowserWindow: FakeWin, screen: twin2, getPort: () => 4001, log: () => {} });
dmD.configure(JSON.parse(JSON.stringify(dmC.getConfig())));
check(wins.length === 1 && wins[0].b.width === 1280 && wins[0].b.x === 1920, 'Gleichnamige Bildschirme: richtiger über Auflösung/Position, nicht der Hauptbildschirm');
// Bildschirm in der Steuerung umgestellt → neue Auswahl gilt
dmD.configure([Object.assign({}, dmD.getConfig()[0], { displayId: '3' })]);
check(dmD.getConfig()[0].displayId === '3' && dmD.getConfig()[0].displayPrimary === true && wins.filter((w) => !w.dead).length === 1 && wins.filter((w) => !w.dead)[0].b.x === 0, 'Bewusste Auswahl in der Steuerung wird übernommen (auch Hauptbildschirm)');
// macOS verschiebt das Fenster beim Anzeigen → wird zurückgesetzt
const pl = mkScreen([disp(1, 'Main', 0, 1920, 1080), disp(2, 'Beamer', 1920, 1920, 1080)]);
wins.length = 0;
const dmE = new DisplayManager({ BrowserWindow: FakeWin, screen: pl, getPort: () => 4001, log: () => {} });
dmE.configure([{ id: 'p', enabled: true, displayId: '2', output: '1' }]);
wins[0].b = { x: 0, y: 0, width: 1920, height: 1080 }; // „verrutscht“ auf den Hauptbildschirm
check(dmE.info().outputs[0].wrongDisplay === true, 'Falscher Bildschirm wird erkannt und in der Steuerung gemeldet');
wins[0].ready();
check(wins[0].b.x === 1920 && dmE.info().outputs[0].wrongDisplay === false, 'Fenster wird nach dem Anzeigen auf den richtigen Bildschirm zurückgesetzt');
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
