#!/usr/bin/env node
'use strict';
/* Baut das NDI-Addon. Es wird KEIN NDI SDK benötigt – nur ein C++-Compiler.
   Zur Laufzeit muss auf dem Rechner die NDI-Laufzeit installiert sein (z. B. über „NDI Tools“, https://ndi.video/tools/). */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const addonDir = path.join(root, 'native', 'ndi');
const optional = process.argv.includes('--optional');
function fail(msg) {
  if (optional) { console.warn('\n⚠ NDI-Unterstützung wird nicht mitgebaut: ' + msg + '\n'); process.exit(0); }
  console.error('\n✖ ' + msg + '\n'); process.exit(1);
}
function findNodeGyp() {
  const local = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  if (fs.existsSync(local)) return local;
  const npmDir = path.join(path.dirname(process.execPath), process.platform === 'win32' ? '' : '..', process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  if (fs.existsSync(npmDir)) return npmDir;
  try { return require.resolve('node-gyp/bin/node-gyp.js'); } catch (_) { return null; }
}
console.log('• Baue NDI-Addon …');
const gyp = findNodeGyp();
const r = gyp ? spawnSync(process.execPath, [gyp, 'rebuild', '--release'], { cwd: addonDir, stdio: 'inherit' })
  : spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'node-gyp', 'rebuild', '--release'], { cwd: addonDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) fail('Build fehlgeschlagen (siehe Ausgabe oben). Ist ein C++-Compiler installiert?');
const out = path.join(addonDir, 'build', 'Release', 'cuegfx_ndi.node');
if (!fs.existsSync(out)) fail('Addon-Datei wurde nicht erzeugt.');
try {
  const info = require(out).info();
  console.log(`\n✔ NDI-Addon gebaut. ${info.available ? 'NDI-Laufzeit gefunden: ' + info.version : 'Hinweis: ' + info.error}`);
} catch (e) { console.log('\n✔ NDI-Addon gebaut. (Selbsttest übersprungen: ' + e.message + ')'); }
