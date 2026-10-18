#!/usr/bin/env node
'use strict';
/* Baut alle nativen Module: NDI (immer möglich) und DeckLink (wenn das Blackmagic SDK vorhanden ist). */
const { spawnSync } = require('child_process');
const path = require('path');
const optional = process.argv.includes('--optional');
const run = (script, opt) => spawnSync(process.execPath, [path.join(__dirname, script)].concat(opt ? ['--optional'] : []), { stdio: 'inherit' }).status;
let failed = 0;
if (run('build-ndi.js', optional) !== 0) failed++;
if (run('build-decklink.js', true) !== 0) failed++;
process.exit(failed && !optional ? 1 : 0);
