#!/usr/bin/env node
'use strict';
/*
 * Setzt die App-Version für einen Build (wird von GitHub Actions aufgerufen).
 *
 *   Tag v1.4.2          → Version 1.4.2
 *   Eingabe "version"   → genau diese Version (z. B. 1.5.0-beta.1)
 *   sonst               → Haupt- und Nebenversion aus package.json + fortlaufende Build-Nummer
 *                          (package.json 1.1.0, Build #27 → 1.1.27)
 *
 * Schreibt version + buildInfo (Commit, Datum, Build-Nr.) in package.json.
 * Die Änderung wird nicht committet – package.json im Repo bleibt die Basis.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const env = process.env;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const run = env.GITHUB_RUN_NUMBER || '0';
const manual = String(env.INPUT_VERSION || '').trim().replace(/^v/, '');
const tag = env.GITHUB_REF_TYPE === 'tag' ? String(env.GITHUB_REF_NAME || '').replace(/^v/, '') : '';

let version, source;
if (manual) { version = manual; source = 'Eingabe'; }
else if (tag) { version = tag; source = 'Tag'; }
else {
  const [major, minor] = pkg.version.split('.');
  version = `${major}.${minor}.${run}`; source = 'Build-Nummer';
}
if (!SEMVER.test(version)) { console.error(`✖ Ungültige Version "${version}" (erwartet z. B. 1.2.3)`); process.exit(1); }

pkg.version = version;
pkg.buildInfo = {
  build: Number(run),
  commit: (env.GITHUB_SHA || '').slice(0, 7),
  date: new Date().toISOString().slice(0, 10)
};
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(`• Version ${version} (${source}), Build #${run}, Commit ${pkg.buildInfo.commit || '-'}`);
if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `version=${version}\n`);
