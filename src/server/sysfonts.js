'use strict';
/*
 * Installierte Schriftarten des Rechners finden.
 * Durchsucht beim Start die Standard-Schriftordner von macOS, Windows und Linux und liest aus jeder
 * TTF/OTF/TTC-Datei den echten Familien- und Schnittnamen (name-Tabelle) sowie Gewicht/Kursiv (OS/2).
 * Läuft im Hintergrund, blockiert den Start nicht.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2']);

function fontDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts'), '/Network/Library/Fonts'];
  if (process.platform === 'win32') {
    const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [path.join(win, 'Fonts'), path.join(local, 'Microsoft', 'Windows', 'Fonts')];
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.local/share/fonts'), path.join(home, '.fonts')];
}

/* ---------- Font-Datei lesen (nur die nötigen Bytes) ---------- */
function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}

function decodeName(buf, platform, encoding) {
  if (platform === 0 || platform === 3) {
    // UTF-16BE
    const sw = Buffer.from(buf);
    for (let i = 0; i + 1 < sw.length; i += 2) { const t = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = t; }
    return sw.toString('utf16le');
  }
  if (platform === 1 && encoding === 0) return buf.toString('latin1');
  return null;
}

/* Eine Schrift an Position `off` (bei TTC: Offset der Unterschrift) auslesen */
function readFace(fd, off) {
  const head = readAt(fd, off, 12);
  if (head.length < 12) return null;
  const numTables = head.readUInt16BE(4);
  if (!numTables || numTables > 200) return null;
  const dir = readAt(fd, off + 12, numTables * 16);
  const tables = {};
  for (let i = 0; i < numTables && (i + 1) * 16 <= dir.length; i++) {
    const tag = dir.toString('latin1', i * 16, i * 16 + 4);
    tables[tag] = { offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) };
  }
  if (!tables.name) return null;
  const nt = readAt(fd, tables.name.offset, Math.min(tables.name.length, 256 * 1024));
  if (nt.length < 6) return null;
  const count = nt.readUInt16BE(2), strOff = nt.readUInt16BE(4);
  const best = {}; // nameID → { score, text }
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > nt.length) break;
    const platform = nt.readUInt16BE(r), encoding = nt.readUInt16BE(r + 2), lang = nt.readUInt16BE(r + 4), id = nt.readUInt16BE(r + 6);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    const len = nt.readUInt16BE(r + 8), o = strOff + nt.readUInt16BE(r + 10);
    if (o + len > nt.length) continue;
    const text = decodeName(nt.subarray(o, o + len), platform, encoding);
    if (!text) continue;
    // Englische Windows-Namen bevorzugen (die nutzt auch der Browser)
    const score = (platform === 3 ? 4 : platform === 0 ? 2 : 1) + (lang === 0x409 || (platform === 1 && lang === 0) ? 4 : 0);
    if (!best[id] || score > best[id].score) best[id] = { score, text: text.replace(/\0/g, '').trim() };
  }
  const n = (id) => (best[id] ? best[id].text : '');
  const family = n(16) || n(1);
  if (!family) return null;
  let weight = 400, italic = false;
  if (tables['OS/2'] && tables['OS/2'].length >= 64) {
    const t = readAt(fd, tables['OS/2'].offset, 64);
    if (t.length >= 64) { weight = t.readUInt16BE(4) || 400; italic = !!(t.readUInt16BE(62) & 1); }
  }
  const style = n(17) || n(2) || 'Regular';
  if (/italic|oblique|kursiv/i.test(style)) italic = true;
  if (weight < 100 || weight > 1000) weight = 400;
  return { family, style, full: n(4) || `${family} ${style}`, postscript: n(6), weight, italic };
}

function readFontFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const sig = readAt(fd, 0, 12);
    if (sig.length < 12) return [];
    const tag = sig.toString('latin1', 0, 4);
    if (tag === 'ttcf') {
      const num = Math.min(sig.readUInt32BE(8), 64);
      const offs = readAt(fd, 12, num * 4);
      const out = [];
      for (let i = 0; i < num; i++) { const f = readFace(fd, offs.readUInt32BE(i * 4)); if (f) out.push(Object.assign(f, { index: i })); }
      return out;
    }
    if (tag === 'wOFF' || tag === 'wOF2') return []; // komprimiert – Name aus Dateiname
    const v = sig.readUInt32BE(0);
    if (v !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') return [];
    const f = readFace(fd, 0);
    return f ? [Object.assign(f, { index: 0 })] : [];
  } catch (_) {
    return [];
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
}

/* ---------- Ordner durchsuchen ---------- */
async function walk(dir, depth, out, limit) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0 && !e.name.startsWith('.')) await walk(p, depth - 1, out, limit);
    else if ((e.isFile() || e.isSymbolicLink()) && EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
}

class SystemFonts {
  constructor(opts) {
    this.dirs = (opts && opts.dirs) || fontDirs();
    this.families = new Map(); // Name → { family, faces: [...] }
    this.files = [];           // Index → Dateipfad (nur diese Dateien werden ausgeliefert)
    this.ready = false;
    this.scanning = false;
    this.error = '';
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    const t0 = Date.now();
    const files = [];
    for (const d of this.dirs) await walk(d, 6, files, 20000);
    const fams = new Map(), fileList = [];
    let n = 0;
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      let faces = ext === '.woff' || ext === '.woff2'
        ? [{ family: path.basename(file, ext).replace(/[-_](Regular|Bold|Italic|Light|Medium|Black|Thin|SemiBold|ExtraBold)+$/i, ''), style: 'Regular', weight: 400, italic: false, index: 0 }]
        : readFontFile(file);
      if (!faces.length) continue;
      const fileId = fileList.push(file) - 1;
      for (const f of faces) {
        if (!f.family || f.family.startsWith('.') || f.family.startsWith('#')) continue; // versteckte Systemschriften (z. B. .SF NS)
        let fam = fams.get(f.family);
        if (!fam) { fam = { family: f.family, faces: [] }; fams.set(f.family, fam); }
        fam.faces.push({ file: fileId, index: f.index, style: f.style, full: f.full, postscript: f.postscript, weight: f.weight, italic: f.italic, collection: ext === '.ttc' || ext === '.otc', ext });
      }
      if (++n % 50 === 0) await new Promise((r) => setImmediate(r)); // Server bleibt reaktionsfähig
    }
    this.families = new Map([...fams.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')));
    this.files = fileList;
    this.ready = true;
    this.scanning = false;
    this.ms = Date.now() - t0;
    return this.families.size;
  }

  names() { return [...this.families.keys()]; }

  list() {
    return [...this.families.values()].map((f) => ({ family: f.family, styles: f.faces.length }));
  }

  file(id) { const p = this.files[Number(id)]; return typeof p === 'string' ? p : null; }

  /* @font-face-Regeln für die angegebenen Familien (local() zuerst, sonst Datei vom Server) */
  css(families) {
    const out = [];
    for (const name of families) {
      const fam = this.families.get(name);
      if (!fam) continue;
      const q = (s) => '"' + String(s).replace(/["\\]/g, '') + '"';
      for (const f of fam.faces) {
        const src = [];
        if (f.full) src.push(`local(${q(f.full)})`);
        if (f.postscript && f.postscript !== f.full) src.push(`local(${q(f.postscript)})`);
        // Schriftsammlungen (.ttc) können Browser nicht per URL laden – dort nur local()
        if (!f.collection) src.push(`url("/api/sysfont/${f.file}${f.ext}")`);
        if (!src.length) continue;
        out.push(`@font-face{font-family:${q(fam.family)};src:${src.join(',')};font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'};font-display:block;}`);
      }
    }
    return out.join('\n');
  }
}

module.exports = { SystemFonts, readFontFile, fontDirs };
