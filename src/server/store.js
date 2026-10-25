'use strict';
/* Persistenz: App-Konfiguration (pro Rechner), Projekte (JSON) und Medienbibliothek */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Types = require('../../public/shared/graphic-types.js');
const { migrateAudience, DEFAULT_QA } = require('./audience');

const uid = (n = 8) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n) || crypto.randomBytes(4).toString('hex');

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function defaultTheme() {
  const p = Types.THEME_PRESETS.studio;
  return Object.assign({ preset: 'studio', customCss: '', textShadow: true }, JSON.parse(JSON.stringify(p)));
}

function newProject(name) {
  return {
    id: uid(10),
    name: name || 'Neues Projekt',
    created: Date.now(),
    settings: {
      outputs: [
        { id: '1', name: 'Hauptausgang', background: 'transparent', audio: true },
        { id: '2', name: 'Bühnenmonitor', background: '#000000', audio: false }
      ]
    },
    theme: defaultTheme(),
    graphics: [],
    variables: { text: { sendung: 'Live-Show' }, lists: { gaeste: { items: ['Gast 1', 'Gast 2'], index: 0 } } },
    sheets: [],
    polls: [],
    questions: [],
    qaSettings: Object.assign({}, DEFAULT_QA)
  };
}

class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.projectsDir = path.join(dataDir, 'projects');
    this.mediaDir = path.join(dataDir, 'media');
    for (const d of [this.dir, this.projectsDir, this.mediaDir]) fs.mkdirSync(d, { recursive: true });
    this.configFile = path.join(dataDir, 'config.json');
    this.config = Object.assign({
      port: 4001,
      currentProjectId: null,
      accessPin: '',
      decklinkOutputs: [],
      ndiOutputs: [],
      ndiLibPath: '',
      chatSources: [],
      audiencePort: 4002,
      audiencePublicUrl: '',
      displayOutputs: [],
      lastSeenVersion: null
    }, readJson(this.configFile, {}));
    this.project = null;
    this._saveTimer = null;
    this._loadCurrent();
  }

  _projectFile(id) { return path.join(this.projectsDir, id.replace(/[^a-zA-Z0-9]/g, '') + '.json'); }

  _loadCurrent() {
    let p = this.config.currentProjectId ? readJson(this._projectFile(this.config.currentProjectId), null) : null;
    if (!p) {
      const list = this.listProjects();
      if (list.length) p = readJson(this._projectFile(list[0].id), null);
    }
    if (!p) { p = newProject('Mein erstes Projekt'); this._seedDemo(p); }
    this.project = this.migrate(p);
    this.config.currentProjectId = this.project.id;
    this.saveProjectNow();
    this.saveConfig();
  }

  _seedDemo(p) {
    const add = (type, name, data, outputs) => {
      const g = this.makeGraphic(type, name, outputs);
      Object.assign(g.data, data || {});
      p.graphics.push(g);
    };
    add('lowerthird', 'Moderation', {});
    add('lowerthird_anim', 'Gast (animiert)', { name: '{{gaeste}}', title: 'Zu Gast bei {{sendung}}' });
    add('message', 'Willkommen', {});
    add('ticker', 'News-Ticker', {});
    add('score', 'Spielstand', {});
    add('bigtimer', 'Countdown Start', {});
    add('speakertimer', 'Redezeit Bühne', {}, ['2']);
    add('custom', 'Eigene Grafik', {});
  }

  /* Ältere oder importierte Projekte auf aktuellen Stand bringen */
  migrate(p) {
    const base = newProject(p.name);
    p.settings = Object.assign({}, base.settings, p.settings || {});
    if (!Array.isArray(p.settings.outputs) || !p.settings.outputs.length) p.settings.outputs = base.settings.outputs;
    p.theme = Object.assign(defaultTheme(), p.theme || {});
    p.variables = p.variables || base.variables;
    p.variables.text = p.variables.text || {};
    p.variables.lists = p.variables.lists || {};
    for (const k of ['sheets', 'polls', 'questions', 'graphics']) if (!Array.isArray(p[k])) p[k] = [];
    migrateAudience(p);
    p.graphics = p.graphics.filter((g) => Types.TYPES[g.type]).map((g) => {
      g.data = Object.assign(Types.defaults(g.type), g.data || {});
      g.outputs = Array.isArray(g.outputs) ? g.outputs : ['1'];
      g.live = !!g.live; g.preview = !!g.preview;
      return g;
    });
    return p;
  }

  makeGraphic(type, name, outputs) {
    if (!Types.TYPES[type]) throw new Error('Unbekannter Grafiktyp: ' + type);
    return { id: uid(8), type, name: name || Types.TYPES[type].label, data: Types.defaults(type), outputs: outputs || ['1'], live: false, preview: false };
  }

  listProjects() {
    return fs.readdirSync(this.projectsDir).filter((f) => f.endsWith('.json')).map((f) => {
      const p = readJson(path.join(this.projectsDir, f), null);
      return p ? { id: p.id, name: p.name, created: p.created || 0, graphics: (p.graphics || []).length } : null;
    }).filter(Boolean).sort((a, b) => a.created - b.created);
  }

  switchProject(id) {
    const p = readJson(this._projectFile(id), null);
    if (!p) throw new Error('Projekt nicht gefunden');
    this.saveProjectNow();
    this.project = this.migrate(p);
    this.config.currentProjectId = id;
    this.saveConfig();
    return this.project;
  }

  createProject(name, from) {
    const p = from ? this.migrate(JSON.parse(JSON.stringify(from))) : newProject(name);
    p.id = uid(10);
    p.name = name || p.name;
    p.created = Date.now();
    for (const g of p.graphics) { g.live = false; g.preview = false; }
    writeJsonAtomic(this._projectFile(p.id), p);
    return p;
  }

  deleteProject(id) {
    if (id === this.project.id) throw new Error('Das aktive Projekt kann nicht gelöscht werden');
    fs.rmSync(this._projectFile(id), { force: true });
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveProjectNow(), 400);
  }

  saveProjectNow() {
    clearTimeout(this._saveTimer);
    if (this.project) writeJsonAtomic(this._projectFile(this.project.id), this.project);
  }

  saveConfig() { writeJsonAtomic(this.configFile, this.config); }

  /* Medien */
  safeMediaName(name) {
    const base = path.basename(String(name || 'datei')).replace(/[^\w.\- äöüÄÖÜß()]/g, '_').slice(0, 120) || 'datei';
    return base;
  }
  uniqueMediaName(name) {
    let n = this.safeMediaName(name);
    const ext = path.extname(n), stem = n.slice(0, n.length - ext.length);
    let i = 1;
    while (fs.existsSync(path.join(this.mediaDir, n))) n = `${stem}-${i++}${ext}`;
    return n;
  }
  mediaPath(name) {
    const p = path.join(this.mediaDir, this.safeMediaName(name));
    if (!p.startsWith(this.mediaDir)) throw new Error('Ungültiger Pfad');
    return p;
  }
  listMedia() {
    return fs.readdirSync(this.mediaDir).filter((f) => !f.startsWith('.') && !f.endsWith('.part')).map((f) => {
      const st = fs.statSync(path.join(this.mediaDir, f));
      return { name: f, size: st.size, kind: mediaKind(f), mtime: st.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
  }
}

function mediaKind(f) {
  const e = path.extname(f).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'].includes(e)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v', '.ogv'].includes(e)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus'].includes(e)) return 'audio';
  if (['.ttf', '.otf', '.woff', '.woff2'].includes(e)) return 'font';
  return 'other';
}

module.exports = { Store, uid, mediaKind, newProject };
