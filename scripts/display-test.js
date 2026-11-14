#!/usr/bin/env node
'use strict';
/* Tests: Bildschirm-Ausgänge – Wiederfinden nach Neustart (neue Bildschirm-ID), Fenster über die ganze Fläche */
const path = require('path');
const { EventEmitter } = require('events');
const { DisplayManager } = require(path.join(__dirname, '..', 'src', 'main', 'displays.js'));
let ok = 0, bad = 0; const check = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? ok++ : bad++; };
const mkScreen = (list) => Object.assign(new EventEmitter(), { list, getAllDisplays() { return this.list; }, getPrimaryDisplay() { return this.list[0]; } });
const disp = (id, label, x, w, h) => ({ id, label, bounds: { x, y: 0, width: w, height: h }, size: { width: w, height: h } });
const wins = [];
class FakeWin {
  constructor(o) { this.o = o; this.b = { x: o.x, y: o.y, width: o.width, height: o.height }; this.dead = false; this.top = null; wins.push(this); }
  setBounds(b) { this.b = Object.assign({}, b); } getBounds() { return this.b; } setMenuBarVisibility() {} loadURL(u) { this.url = u; }
  once() {} on() {} isDestroyed() { return this.dead; } destroy() { this.dead = true; } showInactive() {}
  setAlwaysOnTop(on, lvl) { this.top = lvl; } setVisibleOnAllWorkspaces() {}
}
const built = mkScreen([disp(1, 'Built-in Retina', 0, 1512, 982), disp(77, 'LG HDMI', 1512, 1920, 1080)]);
let saved = null;
const dm1 = new DisplayManager({ BrowserWindow: FakeWin, screen: built, getPort: () => 4001, log: () => {}, onConfigChange: (c) => { saved = c; } });
dm1.configure([{ id: 'd1', enabled: true, displayId: '77', output: '2' }]);
const cfg = dm1.getConfig();
check(cfg[0].displayName === 'LG HDMI' && cfg[0].displaySize === '1920x1080' && cfg[0].displayPrimary === false, 'Merkmale des Bildschirms werden mitgespeichert');
check(wins.length === 1 && wins[0].b.width === 1920 && /\/output\/2$/.test(wins[0].url), 'Ausgangsfenster auf dem HDMI-Bildschirm geöffnet');
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
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
