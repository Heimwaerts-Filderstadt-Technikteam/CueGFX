'use strict';
/* Bitfocus Companion Modul für CueGFX – Live-Verbindung per WebSocket */
const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require('@companion-module/base');
const UpgradeScripts = require('./upgrades');
const { buildActions } = require('./actions');
const { buildFeedbacks } = require('./feedbacks');
const { buildVariables, computeVariables } = require('./variables');
const { buildPresets } = require('./presets');

class CueGfxInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.ws = null;
    this.project = null;
    this.vars = {};
    this.offset = 0;
    this.pending = new Map();
    this.seq = 0;
    this.reconnectTimer = null;
    this.tickTimer = null;
    this.structureSig = '';
    this.lastValues = {};
    this.destroyed = false;
  }

  async init(config) {
    this.config = config;
    this.rebuildDefinitions();
    this.connect();
    this.tickTimer = setInterval(() => this.updateTimeVariables(), 250);
  }

  async destroy() {
    this.destroyed = true;
    clearInterval(this.tickTimer);
    clearTimeout(this.reconnectTimer);
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
  }

  async configUpdated(config) {
    this.config = config;
    this.disconnect();
    this.connect();
  }

  getConfigFields() {
    return [
      { type: 'static-text', id: 'info', width: 12, label: 'Info', value: 'Verbindet sich live mit CueGFX (Desktop-App oder Server). Standard-Port ist 4001.' },
      { type: 'textinput', id: 'host', label: 'Adresse (IP/Hostname)', width: 8, default: '127.0.0.1', regex: Regex.SOMETHING },
      { type: 'textinput', id: 'port', label: 'Port', width: 4, default: '4001', regex: Regex.PORT },
      { type: 'textinput', id: 'pin', label: 'Zugriffs-PIN (falls in CueGFX gesetzt)', width: 6, default: '' }
    ];
  }

  /* ---------- Verbindung ---------- */
  connect() {
    if (this.destroyed) return;
    const host = (this.config.host || '127.0.0.1').trim();
    const port = Number(this.config.port) || 4001;
    const q = new URLSearchParams({ role: 'control' });
    if (this.config.pin) q.set('pin', this.config.pin);
    const url = `ws://${host}:${port}/ws?${q}`;
    this.updateStatus(InstanceStatus.Connecting);
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.updateStatus(InstanceStatus.BadConfig, e.message); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.updateStatus(InstanceStatus.Ok);
      this.log('info', `Verbunden mit CueGFX ${host}:${port}`);
      this.send({ t: 'ping', id: ++this.seq, sent: Date.now() });
      this.pushVariables();
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const [, p] of this.pending) p.reject(new Error('Verbindung getrennt'));
      this.pending.clear();
      if (this.destroyed) return;
      this.updateStatus(InstanceStatus.Disconnected, 'Keine Verbindung zu CueGFX');
      this.pushVariables();
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (_) {} }
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  now() { return Date.now() + this.offset; }

  cmd(cmd, args) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) { reject(new Error('Nicht mit CueGFX verbunden')); return; }
      const id = ++this.seq;
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('Zeitüberschreitung')); }, 5000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.send({ t: 'cmd', id, cmd, args: args || {} });
    });
  }

  async run(cmd, args) {
    try { return await this.cmd(cmd, args); } catch (e) { this.log('warn', `${cmd}: ${e.message}`); return null; }
  }

  onMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.t === 'pong') { this.offset = m.serverTime - Date.now(); return; }
    if (m.t === 'res') {
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
      return;
    }
    if (m.t === 'state') {
      if (m.serverTime && !this.offset) this.offset = m.serverTime - Date.now();
      this.project = m.project;
      this.vars = m.vars || {};
      const sig = this.structureSignature();
      if (sig !== this.structureSig) { this.structureSig = sig; this.rebuildDefinitions(); }
      this.pushVariables();
      this.checkFeedbacks('graphic_live', 'graphic_preview', 'timer_running', 'timer_below', 'any_preview', 'poll_open', 'list_index', 'score_leading', 'has_new_questions', 'qa_has_active', 'qa_setting');
    }
  }

  /* Struktur = alles, was Dropdowns, Variablen-Namen oder Presets beeinflusst */
  structureSignature() {
    const p = this.project;
    if (!p) return '';
    return JSON.stringify([
      p.id, p.graphics.map((g) => [g.id, g.name, g.type]), Object.keys(p.variables.text), Object.keys(p.variables.lists),
      p.polls.map((x) => [x.id, x.question, x.type]), p.settings.outputs.map((o) => [o.id, o.name])
    ]);
  }

  rebuildDefinitions() {
    this.setActionDefinitions(buildActions(this));
    this.setFeedbackDefinitions(buildFeedbacks(this));
    this.setVariableDefinitions(buildVariables(this));
    this.setPresetDefinitions(buildPresets(this));
    this.lastValues = {};
    this.pushVariables();
  }

  pushVariables() {
    const all = computeVariables(this);
    const changed = {};
    for (const [k, v] of Object.entries(all)) if (this.lastValues[k] !== v) { changed[k] = v; this.lastValues[k] = v; }
    if (Object.keys(changed).length) this.setVariableValues(changed);
  }

  updateTimeVariables() {
    if (!this.project) return;
    const hasTimer = this.project.graphics.some((g) => g.data && g.data.timer && g.data.timer.running);
    if (hasTimer) { this.pushVariables(); this.checkFeedbacks('timer_below'); }
  }

  /* ---------- Hilfen für Aktionen/Feedbacks ---------- */
  graphics() { return this.project ? this.project.graphics : []; }
  findGraphic(ref) {
    if (!ref) return null;
    const r = String(ref).trim();
    return this.graphics().find((g) => g.id === r) || this.graphics().find((g) => g.name.toLowerCase() === r.toLowerCase()) || null;
  }
}

runEntrypoint(CueGfxInstance, UpgradeScripts);
