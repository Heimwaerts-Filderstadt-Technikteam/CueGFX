#!/usr/bin/env node
'use strict';
/*
 * Baut das native DeckLink-Addon für macOS, Windows oder Linux.
 *
 * Voraussetzungen:
 *   - Blackmagic Desktop Video (Treiber) installiert
 *   - Blackmagic "Desktop Video SDK" (kostenlos, https://www.blackmagicdesign.com/developer) entpackt
 *   - Umgebungsvariable DECKLINK_SDK_DIR zeigt auf den SDK-Ordner (enthält "Mac", "Win", "Linux")
 *     oder das SDK liegt unter ./sdk/decklink
 *   - C++-Compiler: macOS Xcode Command Line Tools · Windows Visual Studio 2022 Build Tools mit "Desktopentwicklung mit C++" · Linux build-essential
 *
 * Aufruf: npm run build:decklink
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const addonDir = path.join(root, 'native', 'decklink');

const optional = process.argv.includes('--optional');
function fail(msg) {
  if (optional) { console.warn('\n⚠ DeckLink-Unterstützung wird nicht mitgebaut: ' + msg + '\n  Die App funktioniert trotzdem (alle Ausgänge außer DeckLink).\n'); process.exit(0); }
  console.error('\n✖ ' + msg + '\n'); process.exit(1);
}

const plat = process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Win' : 'Linux';
const marker = process.platform === 'win32' ? 'DeckLinkAPI.idl' : 'DeckLinkAPI.h';

/* Sucht den include-Ordner des SDK. Funktioniert mit dem Komplett-SDK (Mac/Win/Linux/include)
   und mit den einzelnen OS-Downloads (z. B. "Blackmagic DeckLink SDK 14.x/include"). */
function findInclude() {
  const candidates = [process.env.DECKLINK_SDK_DIR, path.join(root, 'sdk', 'decklink'), path.join(root, 'sdk')].filter(Boolean);
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
    const hits = entries.some((e) => e.isFile() && e.name === marker) ? [dir] : [];
    if (depth > 0) for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX') hits.push(...walk(path.join(dir, e.name), depth - 1));
    return hits;
  };
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const hits = walk(path.resolve(c), 5);
    if (!hits.length) continue;
    // Bevorzugt <OS>/include, sonst irgendein include-Ordner (aber keinen anderer Plattformen)
    const others = ['Mac', 'Win', 'Linux'].filter((p) => p !== plat);
    const own = hits.find((h) => h.split(path.sep).includes(plat));
    const neutral = hits.find((h) => !others.some((o) => h.split(path.sep).includes(o)));
    const inc = own || neutral;
    if (inc) return { sdk: path.resolve(c), inc };
  }
  return null;
}

const found = findInclude();
if (!found) fail(`DeckLink SDK für ${plat} nicht gefunden (gesucht: ${marker}). Bitte das "Desktop Video SDK" von Blackmagic laden, entpacken und DECKLINK_SDK_DIR auf den Ordner setzen (oder nach ./sdk/decklink legen).`);
const sdk = found.sdk;
const inc = found.inc;
console.log('• SDK-Header:', inc);
console.log('• DeckLink SDK:', sdk);
const ver = (() => { try { return (fs.readFileSync(path.join(inc, 'DeckLinkAPIVersion.h'), 'utf8').match(/VERSION_STRING\s+"([^"]+)"/) || [])[1]; } catch (_) { return null; } })();
if (ver) console.log('• SDK-Version:', ver);

/* SDK-Header ins Projekt kopieren (vermeidet Probleme mit Leerzeichen und Pfaden außerhalb des Build-Ordners) */
const genInc = path.join(addonDir, 'gen', 'sdk-include');
fs.rmSync(genInc, { recursive: true, force: true });
fs.mkdirSync(genInc, { recursive: true });
for (const f of fs.readdirSync(inc)) {
  const src = path.join(inc, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(genInc, f));
}

/* Windows: DeckLinkAPI.idl mit MIDL in Header + GUID-Datei übersetzen */
if (process.platform === 'win32') {
  const gen = path.join(addonDir, 'gen', 'win');
  fs.mkdirSync(gen, { recursive: true });
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) fail('Visual Studio (Build Tools) nicht gefunden. Bitte "Visual Studio 2022 Build Tools" mit "Desktopentwicklung mit C++" installieren.');
  const vsPath = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  const vcvars = path.join(vsPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!fs.existsSync(vcvars)) fail('vcvars64.bat nicht gefunden: ' + vcvars);
  const idl = path.join(genInc, 'DeckLinkAPI.idl');
  console.log('• Übersetze DeckLinkAPI.idl mit MIDL …');
  const cmd = `call "${vcvars}" >nul && midl /nologo /env x64 /h DeckLinkAPI_h.h /iid DeckLinkAPI_i.c /tlb DeckLinkAPI.tlb /out "${gen}" /I "${genInc}" "${idl}"`;
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { stdio: 'inherit', windowsVerbatimArguments: true });
  if (r.status !== 0 || !fs.existsSync(path.join(gen, 'DeckLinkAPI_h.h'))) fail('MIDL fehlgeschlagen');
  // DeckLinkAPIVersion.h liegt im SDK-Include-Ordner und wird über die Include-Pfade gefunden
}

/* node-gyp suchen: lokal installiert, sonst das mit npm gebündelte */
function findNodeGyp() {
  const local = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  if (fs.existsSync(local)) return local;
  const npmDir = path.join(path.dirname(process.execPath), process.platform === 'win32' ? '' : '..', process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  if (fs.existsSync(npmDir)) return npmDir;
  try { return require.resolve('node-gyp/bin/node-gyp.js'); } catch (_) { return null; }
}
const gyp = findNodeGyp();
const env = Object.assign({}, process.env, { DECKLINK_SDK_DIR: sdk });
console.log('• Baue Addon …');
const args = gyp ? [gyp, 'rebuild', '--release'] : null;
const r = args ? spawnSync(process.execPath, args, { cwd: addonDir, stdio: 'inherit', env })
  : spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'node-gyp', 'rebuild', '--release'], { cwd: addonDir, stdio: 'inherit', env, shell: process.platform === 'win32' });
if (r.status !== 0) fail('Build fehlgeschlagen (siehe Ausgabe oben).');

const out = path.join(addonDir, 'build', 'Release', 'cuegfx_decklink.node');
if (!fs.existsSync(out)) fail('Addon-Datei wurde nicht erzeugt.');
try {
  const addon = require(out);
  const v = addon.version();
  const list = addon.listDevices();
  console.log(`\n✔ DeckLink-Addon gebaut (SDK ${v.sdk}, Treiber ${v.driver || 'nicht gefunden'})`);
  if (list.error) console.log('  Hinweis:', list.error);
  for (const d of list.devices) console.log(`  – ${d.name}${d.externalKeying ? ' · Fill+Key' : ''}${d.internalKeying ? ' · interner Keyer' : ''}${d.canInput ? ' · Eingang' : ''}`);
} catch (e) {
  console.log('\n✔ Addon gebaut. (Selbsttest übersprungen: ' + e.message + ')');
}
