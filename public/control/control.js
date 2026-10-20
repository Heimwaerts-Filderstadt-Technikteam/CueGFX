/* CueGFX – Steuer-Oberfläche */
(function () {
  'use strict';
  const { h, debounce, toast, modal, menu, api, copyText } = UI;
  const T = window.CueTypes;
  const $ = (id) => document.getElementById(id);
  const client = new CueClient({ role: 'control' });

  const S = {
    project: null, vars: {}, media: [], hw: null, chat: [], chatStatus: 'getrennt', chatChannel: '',
    tab: 'graphics', sel: localStorage.getItem('cue.sel') || null, search: '', pgmOut: localStorage.getItem('cue.pgm') || '1', info: null,
    qaFilter: '', qaSort: 'likes', dlDraft: null, dsDraft: null, ndiDraft: null
  };
  const mediaListeners = new Set();
  const groupsClosed = new Set(JSON.parse(localStorage.getItem('cue.closed') || '["Erweitert"]'));

  async function cmd(name, args) {
    try { return await client.cmd(name, args || {}); } catch (e) { toast(e.message, 'err'); throw e; }
  }
  const run = (name, args) => cmd(name, args).catch(() => {});
  const graphic = (id) => S.project && S.project.graphics.find((g) => g.id === id);
  const outputs = () => (S.project ? S.project.settings.outputs : []);

  /* ---------- Medien ---------- */
  async function reloadMedia() {
    try { S.media = await api('/api/media'); } catch (_) { S.media = []; }
    mediaListeners.forEach((f) => { try { f(); } catch (_) {} });
    if (S.tab === 'media') renderTab(true);
  }
  const fontNames = () => S.media.filter((m) => m.kind === 'font').map((m) => m.name.replace(/\.[^.]+$/, ''));
  const env = {
    media: () => S.media, reloadMedia,
    polls: () => (S.project ? S.project.polls : []),
    fonts: fontNames,
    onMediaChange: (f) => { mediaListeners.add(f); },
    sub: (s) => subVars(s),
    themeVars: () => themeVars()
  };

  function subVars(str) {
    str = String(str === undefined || str === null ? '' : str);
    return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, n) => {
      const d = new Date(client.now()); const p = (x) => String(x).padStart(2, '0');
      if (n === 'time') return `${p(d.getHours())}:${p(d.getMinutes())}`;
      if (n === 'time:s') return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      if (n === 'date') return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
      const parts = n.split('|');
      const v = S.vars[parts[0].trim()];
      return v !== undefined && v !== '' ? v : (parts[1] || '').trim();
    });
  }
  function themeVars() {
    const th = (S.project && S.project.theme) || {};
    return {
      '--primary': th.primary, '--secondary': th.secondary, '--accent': th.accent, '--text': th.text, '--text-on-primary': th.textOnPrimary,
      '--panel': th.panel, '--font': th.font, '--font-heading': th.headingFont, '--radius': (Number(th.radius) || 0) + 'px',
      '--shadow': `0 10px 30px rgba(0,0,0,${Number(th.shadow) || 0})`
    };
  }

  /* ---------- Verbindung ---------- */
  client.on('open', () => { $('conn').classList.add('on'); $('conn').title = 'Verbunden'; });
  client.on('close', () => { $('conn').classList.remove('on'); $('conn').title = 'Getrennt – verbinde neu …'; });
  client.on('state', (m) => {
    const first = !S.project;
    const projChanged = S.project && S.project.id !== m.project.id;
    S.project = m.project; S.vars = m.vars || {}; S.info = Object.assign({}, S.info, m.info);
    if (projChanged) { S.sel = null; editorFor = null; }
    if (first || projChanged) { buildPgmSelect(); }
    renderAll();
  });
  client.on('hw', (m) => { S.hw = m; if (S.tab === 'outputs') renderTab(); });
  client.on('chatLog', (m) => { S.chat = m.log || []; S.chatStatus = m.status; S.chatChannel = m.channel || ''; if (S.tab === 'chat') renderTab(); });
  client.on('chat', (m) => { S.chat.push(m.msg); if (S.chat.length > 300) S.chat.shift(); if (S.tab === 'chat') appendChat(m.msg); });
  client.on('chatStatus', (m) => { S.chatStatus = m.status; const el = $('chat-status'); if (el) el.textContent = m.status; });
  client.on('media', () => reloadMedia());
  client.on('projects', () => {});
  client.on('sheetOk', () => {});

  /* ---------- Gesamt-Rendering ---------- */
  function renderAll() {
    if (!UI.whenReleased(renderAll)) return;
    renderHeader();
    renderList();
    if (S.tab === 'graphics') renderEditor(); else renderTab();
    renderLiveList();
    buildPgmSelect(true);
  }

  function renderHeader() {
    $('proj-name').textContent = S.project.name;
    document.title = `CueGFX ${(S.info && S.info.version) || ''} – ${S.project.name}`;
    const pv = S.project.graphics.filter((g) => g.preview).length;
    $('btn-take').disabled = pv === 0;
    $('btn-take').textContent = pv ? `TAKE (${pv})` : 'TAKE';
    const newQ = S.project.questions.filter((q) => q.status === 'pending').length;
    $('qa-badge').hidden = !newQ; $('qa-badge').textContent = newQ;
  }

  /* ---------- Grafikliste ---------- */
  function quickControls(g) {
    const t = T.TYPES[g.type];
    const box = h('div', { class: 'quick', onclick: (e) => { if (e.target.closest('button')) e.stopPropagation(); } });
    const hasTimer = (t.controls || []).includes('timer') && (g.type !== 'score' || g.data.showClock);
    if (hasTimer) {
      box.append(
        h('button', { class: 'btn xs', title: 'Start/Pause', onclick: () => run('timer.toggle', { id: g.id }) }, g.data.timer && g.data.timer.running ? '❚❚' : '▶'),
        h('button', { class: 'btn xs', title: 'Zurücksetzen', onclick: () => run('timer.reset', { id: g.id }) }, '↺'),
        h('span', { class: 'tv' + (g.data.timer && g.data.timer.running ? ' run' : ''), dataset: { timer: g.id } }, ''));
    }
    if (g.type === 'score') {
      box.append(h('button', { class: 'btn xs', onclick: () => run('score.add', { id: g.id, team: 'a', delta: 1 }) }, `${g.data.teamA} +1`),
        h('span', { class: 'tv' }, `${g.data.scoreA}:${g.data.scoreB}`),
        h('button', { class: 'btn xs', onclick: () => run('score.add', { id: g.id, team: 'b', delta: 1 }) }, `${g.data.teamB} +1`));
    }
    if ((t.controls || []).includes('step')) {
      const n = g.type === 'lyrics' ? String(g.data.text || '').split(/\n\s*\n/).filter((s) => s.trim()).length : (g.data.items || []).length;
      box.append(h('button', { class: 'btn xs', onclick: () => run('step', { id: g.id, delta: -1 }) }, '◀'),
        h('span', { class: 'tv' }, `${(Number(g.data.index) || 0) + 1}/${n}`),
        h('button', { class: 'btn xs', onclick: () => run('step', { id: g.id, delta: 1 }) }, '▶'));
    }
    return box.childNodes.length ? box : null;
  }

  function graphicMenu(anchor, g) {
    menu(anchor, [
      { label: '⧉ Duplizieren', action: () => cmd('graphic.duplicate', { id: g.id }).then((r) => { S.sel = r.id; }) },
      { label: '✎ Umbenennen', action: async () => { const n = await UI.prompt('Grafik umbenennen', g.name); if (n) run('graphic.update', { id: g.id, name: n }); } },
      { label: '🔗 API-URL (Toggle) kopieren', action: () => copyText(`${location.origin}/api/graphics/${g.id}/toggle`) },
      '-',
      { label: '🗑 Löschen', action: async () => { if (await UI.confirm('Grafik löschen?', `„${g.name}“ wird entfernt.`, 'Löschen')) run('graphic.remove', { id: g.id }); } }
    ]);
  }

  let dragId = null;
  function renderList() {
    const list = $('glist');
    const q = S.search.trim().toLowerCase();
    const items = S.project.graphics.filter((g) => !q || g.name.toLowerCase().includes(q) || (T.TYPES[g.type].label || '').toLowerCase().includes(q));
    list.innerHTML = '';
    if (!items.length) list.appendChild(h('div', { class: 'empty' }, q ? 'Keine Treffer.' : 'Noch keine Grafiken. Mit „+ Grafik“ anlegen.'));
    for (const g of items) {
      const t = T.TYPES[g.type];
      const outNames = g.outputs.map((o) => h('i', { title: (outputs().find((x) => x.id === o) || {}).name || o }, o));
      const row = h('div', {
        class: `gitem${g.id === S.sel ? ' sel' : ''}${g.live ? ' live' : ''}${g.preview ? ' pvw' : ''}`, dataset: { id: g.id },
        onclick: () => select(g.id),
        oncontextmenu: (e) => { e.preventDefault(); graphicMenu(e.target, g); }
      },
      h('div', { class: 'drag', title: 'Ziehen zum Sortieren', onmousedown: () => { row.draggable = true; } }, '⋮⋮'),
      h('div', { class: 'ico' }, t.icon),
      h('div', { class: 'nm' }, h('b', null, g.name), h('small', null, t.label, h('span', { class: 'outdots' }, outNames))),
      h('div', { class: 'acts' },
        h('button', { class: 'pv' + (g.preview ? ' on' : ''), title: 'Vorschau', onclick: (e) => { e.stopPropagation(); run('graphic.preview', { id: g.id }); } }, 'PVW'),
        h('button', { class: 'lv' + (g.live ? ' on' : ''), title: 'Live ein/aus', onclick: (e) => { e.stopPropagation(); run('graphic.toggle', { id: g.id }); } }, 'LIVE')),
      quickControls(g));
      row.addEventListener('dragstart', (e) => { dragId = g.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.id); });
      row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); dragId = null; list.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
      row.addEventListener('dragover', (e) => {
        if (!dragId || dragId === g.id) return;
        e.preventDefault();
        const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const after = row.classList.contains('drop-after');
        const ids = S.project.graphics.map((x) => x.id).filter((id) => id !== dragId);
        ids.splice(ids.indexOf(g.id) + (after ? 1 : 0), 0, dragId);
        run('graphic.reorder', { ids });
      });
      list.appendChild(row);
    }
    tickTimers();
  }

  function renderLiveList() {
    const box = $('live-list');
    box.innerHTML = '';
    const live = S.project.graphics.filter((g) => g.live);
    if (!live.length) { box.appendChild(h('div', { class: 'hint' }, 'Nichts auf Sendung.')); return; }
    box.appendChild(h('div', { class: 'hint', style: { marginBottom: '2px' } }, 'Auf Sendung:'));
    for (const g of live) box.appendChild(h('span', { class: 'chip' }, g.name, h('button', { title: 'Ausblenden', onclick: () => run('graphic.hide', { id: g.id }) }, '✕')));
  }

  function select(id) {
    S.sel = id; localStorage.setItem('cue.sel', id || '');
    if (S.tab !== 'graphics') setTab('graphics');
    document.querySelectorAll('.gitem').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
    renderEditor();
    document.getElementById('main').classList.add('edit');
  }

  /* ---------- Editor ---------- */
  let editorFor = null, editorType = null, fieldEls = [], editorExtras = [];
  const pending = {};
  const flushers = {};
  function sendData(id, key, value) {
    pending[id] = pending[id] || {};
    pending[id][key] = value;
    if (!flushers[id]) flushers[id] = debounce(() => { const d = pending[id]; pending[id] = {}; if (Object.keys(d).length) run('graphic.update', { id, data: d }); }, 120);
    flushers[id]();
  }

  function renderEditor() {
    const ed = $('editor');
    const g = graphic(S.sel);
    if (!g) {
      editorFor = null;
      ed.innerHTML = '';
      ed.appendChild(h('div', { class: 'empty', style: { paddingTop: '80px' } },
        h('div', { style: { fontSize: '40px' } }, '▭'), h('p', null, 'Grafik links auswählen oder neu anlegen.'),
        h('p', { class: 'hint' }, 'Tastenkürzel: ', h('kbd', null, 'Strg+Enter'), ' Take · ', h('kbd', null, 'Strg+⌫'), ' alles aus · ', h('kbd', null, 'Strg+D'), ' duplizieren')));
      return;
    }
    if (editorFor === g.id && editorType === g.type) { syncEditor(g); return; }
    editorFor = g.id; editorType = g.type;
    ed.innerHTML = '';
    fieldEls = []; editorExtras = [];
    const t = T.TYPES[g.type];

    const nameInp = h('input', { value: g.name, oninput: debounce(() => run('graphic.update', { id: g.id, name: nameInp.value }), 300) });
    const pv = h('button', { class: 'pv', onclick: () => run('graphic.preview', { id: g.id }) }, 'PVW');
    const lv = h('button', { class: 'lv', onclick: () => run('graphic.toggle', { id: g.id }) }, 'LIVE');
    const more = h('button', { class: 'btn sm ghost', title: 'Mehr', onclick: (e) => graphicMenu(e.currentTarget, g) }, '⋯');
    ed.appendChild(h('div', { class: 'ed-title' }, h('div', { class: 'ico', style: { fontSize: '20px' } }, t.icon), nameInp, pv, lv, more));
    editorExtras.push(() => { const gg = graphic(g.id); if (!gg) return; pv.classList.toggle('on', gg.preview); lv.classList.toggle('on', gg.live); if (!UI.isFocused(nameInp)) nameInp.value = gg.name; });

    // Ausgänge
    const outBox = h('div', { class: 'outs-pick' });
    const renderOuts = () => {
      const gg = graphic(g.id); if (!gg) return;
      outBox.innerHTML = '';
      for (const o of outputs()) {
        const cb = h('input', { type: 'checkbox', checked: gg.outputs.includes(o.id), onchange: () => {
          const cur = new Set(graphic(g.id).outputs);
          cb.checked ? cur.add(o.id) : cur.delete(o.id);
          run('graphic.update', { id: g.id, outputs: [...cur] });
        } });
        outBox.appendChild(h('label', null, cb, `${o.id} · ${o.name}`));
      }
    };
    renderOuts();
    editorExtras.push(renderOuts);
    ed.appendChild(h('div', { class: 'ed-top' }, h('span', { class: 'hint' }, 'Ausgänge:'), outBox));

    // Steuerung
    const ctrls = t.controls || [];
    if (ctrls.length) {
      const body = h('div', { class: 'gbody' });
      if (ctrls.includes('score')) body.appendChild(scorePanel(g));
      if (ctrls.includes('timer')) body.appendChild(timerPanel(g));
      if (ctrls.includes('step')) body.appendChild(stepPanel(g));
      if (ctrls.includes('qa')) body.appendChild(qaPanel());
      ed.appendChild(group('Steuerung', body));
    }

    // Felder nach Gruppen
    const groups = {};
    for (const f of T.allFields(g.type)) {
      if (f.hidden || f.type === 'timer') continue;
      const gname = f.group || 'Inhalt';
      (groups[gname] = groups[gname] || []).push(f);
    }
    for (const [gname, defs] of Object.entries(groups)) {
      const body = h('div', { class: 'gbody' });
      for (const def of defs) {
        let el;
        if (def.type === 'builder') {
          el = CueBuilder(g.data.layers, (layers) => sendData(g.id, 'layers', layers), env);
        } else {
          el = UI.field(def, g.data[def.key], (v) => {
            sendData(g.id, def.key, v);
            const gg = graphic(g.id); if (gg) gg.data[def.key] = v;
            applyShowIf();
          }, env);
        }
        el.def = def;
        fieldEls.push(el);
        body.appendChild(el);
      }
      if (gname === 'Inhalt') body.appendChild(h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'Variablen in Texten: ', h('code', null, '{{name}}'), ', ', h('code', null, '{{time}}'), ', ', h('code', null, '{{tabelle.B2}}'), ' – siehe Tab „Variablen“.'));
      ed.appendChild(group(gname, body));
    }

    // API-Hinweis
    const base = `${location.origin}/api/graphics/${g.id}`;
    ed.appendChild(group('API / Companion', h('div', { class: 'gbody' },
      ...['show', 'hide', 'toggle', 'preview'].map((a) => h('div', { class: 'field' }, h('label', null, a), h('div', { class: 'row' }, h('div', { class: 'copy' }, `${base}/${a}`), h('button', { class: 'btn xs', onclick: () => copyText(`${base}/${a}`) }, 'Kopieren')))),
      h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'GET oder POST. Felder ändern: ', h('code', null, `${base}/update?title=Neuer%20Titel`), ' (Grafik umbenennen: ', h('code', null, 'rename=…'), '). Grafiken können statt per ID auch per Name angesprochen werden.')), true));

    applyShowIf();
    syncEditor(g);
  }

  function group(name, body, closedDefault) {
    const closed = groupsClosed.has(name) || (closedDefault && !groupsClosed.has('!' + name));
    const el = h('div', { class: 'group' + (closed ? ' closed' : '') });
    el.appendChild(h('h3', { onclick: () => {
      el.classList.toggle('closed');
      const isClosed = el.classList.contains('closed');
      groupsClosed.delete(name); groupsClosed.delete('!' + name);
      if (isClosed) groupsClosed.add(name); else if (closedDefault) groupsClosed.add('!' + name);
      localStorage.setItem('cue.closed', JSON.stringify([...groupsClosed]));
    } }, name));
    el.appendChild(body);
    return el;
  }

  function applyShowIf() {
    const g = graphic(editorFor); if (!g) return;
    for (const el of fieldEls) {
      const si = el.def.showIf;
      if (!si) continue;
      const ok = Object.entries(si).every(([k, v]) => g.data[k] === v);
      el.style.display = ok ? '' : 'none';
    }
  }

  function syncEditor(g) {
    for (const el of fieldEls) {
      const k = el.def.key;
      if (pending[g.id] && k in pending[g.id]) continue;
      el.setValue && el.setValue(g.data[k]);
    }
    for (const fn of editorExtras) fn(g);
    applyShowIf();
  }

  function timerPanel(g) {
    const disp = h('div', { class: 'bigtime', dataset: { timer: g.id } });
    const setInp = h('input', { type: 'text', class: 'inp', style: { width: '110px' }, placeholder: 'mm:ss' });
    const mode = h('select', { class: 'inp', style: { width: 'auto' }, onchange: () => run('timer.mode', { id: g.id, mode: mode.value }) },
      h('option', { value: 'down' }, 'Countdown'), h('option', { value: 'up' }, 'Stoppuhr'));
    const startBtn = h('button', { class: 'btn primary', onclick: () => run('timer.toggle', { id: g.id }) }, 'Start');
    const durInfo = h('span', { class: 'hint' });
    const doSet = () => { if (setInp.value.trim()) { run('timer.set', { id: g.id, seconds: setInp.value.trim(), elapsed: mode.value === 'up' }); setInp.value = ''; } };
    setInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSet(); });
    const box = h('div', { class: 'ctrlbar' },
      disp, startBtn,
      h('button', { class: 'btn', onclick: () => run('timer.reset', { id: g.id }) }, '↺ Reset'),
      h('button', { class: 'btn sm', onclick: () => run('timer.add', { id: g.id, seconds: -60 }) }, '−1:00'),
      h('button', { class: 'btn sm', onclick: () => run('timer.add', { id: g.id, seconds: -10 }) }, '−10s'),
      h('button', { class: 'btn sm', onclick: () => run('timer.add', { id: g.id, seconds: 10 }) }, '+10s'),
      h('button', { class: 'btn sm', onclick: () => run('timer.add', { id: g.id, seconds: 60 }) }, '+1:00'),
      h('div', { class: 'row', style: { width: '100%' } }, mode, setInp, h('button', { class: 'btn sm', onclick: doSet }, 'Setzen'),
        ...[60, 300, 600, 900, 1800].map((s) => h('button', { class: 'btn xs', onclick: () => run('timer.set', { id: g.id, seconds: s }) }, `${s / 60}′`)), durInfo));
    editorExtras.push(() => {
      const gg = graphic(g.id); if (!gg) return;
      const t = gg.data.timer || {};
      startBtn.textContent = t.running ? '❚❚ Pause' : '▶ Start';
      if (!UI.isFocused(mode)) mode.value = t.mode || 'down';
      durInfo.textContent = t.mode === 'up' ? '' : `Dauer: ${T.formatDuration((t.duration || 0) * 1000, 'auto')}`;
    });
    return box;
  }

  function scorePanel(g) {
    const team = (side) => {
      const val = h('div', { class: 'val' });
      const name = h('b');
      const btns = [-1, 1, 2, 3].map((d) => h('button', { class: 'btn sm', onclick: () => run('score.add', { id: g.id, team: side, delta: d }) }, d > 0 ? `+${d}` : String(d)));
      const el = h('div', { class: 'team' }, name, val, h('div', { class: 'row' }, btns));
      editorExtras.push(() => {
        const gg = graphic(g.id); if (!gg) return;
        const d = gg.data;
        name.textContent = side === 'a' ? d.teamA : d.teamB;
        val.textContent = side === 'a' ? d.scoreA : d.scoreB;
        el.style.setProperty('--tc', side === 'a' ? d.colorA : d.colorB);
      });
      return el;
    };
    return h('div', { class: 'scorebox' }, team('a'), team('b'),
      h('div', { class: 'row', style: { gridColumn: '1 / -1' } },
        h('button', { class: 'btn sm', onclick: () => run('score.reset', { id: g.id }) }, 'Punkte auf 0'),
        h('button', { class: 'btn sm', onclick: () => run('score.swap', { id: g.id }) }, '⇄ Seiten tauschen')));
  }

  function qaPanel() {
    const info = h('div', { style: { flex: '1', minWidth: '200px' } });
    const box = h('div', { class: 'ctrlbar' }, info,
      h('button', { class: 'btn primary', onclick: () => run('qa.activeNext', { sort: S.qaSort || 'likes' }) }, 'Nächste Frage ▶'),
      h('button', { class: 'btn', onclick: () => run('qa.resolveActive') }, '✓ Aktive gelöst'),
      h('button', { class: 'btn sm', onclick: () => { S.qaFilter = 'pending'; setTab('audience'); } }, 'Moderation öffnen'));
    editorExtras.push(() => {
      const qsAll = S.project.questions;
      const a = qsAll.find((q) => q.active);
      const pend = qsAll.filter((q) => q.status === 'pending').length;
      const open = qsAll.filter((q) => q.status === 'live' && !q.resolved).length;
      info.innerHTML = '';
      info.append(h('div', null, a ? h('b', null, 'Aktiv: ') : h('span', { class: 'hint' }, 'Keine aktive Frage'), a ? a.text : ''),
        h('div', { class: 'hint' }, `${open} offen · ${pend} zu prüfen`));
    });
    return box;
  }

  function stepPanel(g) {
    const slides = h('div', { class: 'slides' });
    const pos = h('span', { class: 'hint' });
    const box = h('div', { class: 'stepbox' },
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => run('step', { id: g.id, delta: -1 }) }, '◀ Zurück'),
        h('button', { class: 'btn primary', onclick: () => run('step', { id: g.id, delta: 1 }) }, 'Weiter ▶'), pos,
        h('span', { class: 'hint' }, 'Tipp: ', h('kbd', null, '←'), h('kbd', null, '→'), ' wenn die Liste fokussiert ist')),
      slides);
    slides.tabIndex = 0;
    slides.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); run('step', { id: g.id, delta: 1 }); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); run('step', { id: g.id, delta: -1 }); }
    });
    let lastKey = '';
    editorExtras.push(() => {
      const gg = graphic(g.id); if (!gg) return;
      const items = gg.type === 'lyrics' ? String(gg.data.text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
        : (gg.data.items || []).map((it) => `${it.time ? it.time + ' · ' : ''}${it.title}${it.subtitle ? ' – ' + it.subtitle : ''}`);
      const idx = Number(gg.data.index) || 0;
      pos.textContent = `${Math.min(idx + 1, items.length)} / ${items.length}`;
      const key = JSON.stringify(items) + idx;
      if (key === lastKey) return;
      lastKey = key;
      slides.innerHTML = '';
      items.forEach((s, i) => slides.appendChild(h('div', { class: 'slide' + (i === idx ? ' cur' : i === idx + 1 ? ' nxt' : ''), onclick: () => run('step.goto', { id: g.id, index: i }) }, s)));
      const c = slides.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'nearest' });
    });
    return box;
  }

  /* ---------- Timer-Anzeigen live aktualisieren ---------- */
  function tickTimers() {
    if (!S.project) return;
    const now = client.now();
    document.querySelectorAll('[data-timer]').forEach((el) => {
      const g = graphic(el.dataset.timer); if (!g || !g.data.timer) return;
      const t = g.data.timer;
      const v = T.timerValueMs(t, now);
      const txt = t.mode === 'up' ? T.formatCountUp(v, g.data.format || 'auto') : T.formatDuration(v, g.data.format || 'auto');
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('run', !!t.running);
      el.classList.toggle('over', t.mode !== 'up' && v < 0);
    });
  }
  setInterval(tickTimers, 200);

  /* ---------- Neue Grafik ---------- */
  function addGraphicDialog() {
    const box = h('div', { class: 'types' });
    for (const cat of T.CATEGORIES) {
      const types = Object.values(T.TYPES).filter((t) => t.category === cat);
      if (!types.length) continue;
      box.appendChild(h('h4', null, cat));
      for (const t of types) box.appendChild(h('button', { class: 'type-card', onclick: async () => {
        m.close();
        const r = await cmd('graphic.add', { type: t.type, after: S.sel || undefined });
        S.sel = r.id; editorFor = null;
        setTimeout(() => select(r.id), 50);
      } }, h('div', { class: 'ico' }, t.icon), h('div', null, h('b', null, t.label))));
    }
    const m = modal('Neue Grafik', box, { width: 900 });
  }

  /* ---------- Tabs ---------- */
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('main').classList.toggle('wide', tab !== 'graphics');
    editorFor = null;
    if (tab === 'graphics') renderEditor(); else renderTab(true);
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

  let tabDirty = false;
  const renderTabLater = () => renderTab();
  function renderTab(force) {
    const ed = $('editor');
    if (!force && !UI.whenReleased(renderTabLater)) return;
    if (!force && UI.isEditing(ed)) {
      if (!tabDirty) { tabDirty = true; ed.addEventListener('focusout', function f() { setTimeout(() => { if (!UI.isEditing(ed)) { ed.removeEventListener('focusout', f); tabDirty = false; renderTab(true); } }, 50); }); }
      return;
    }
    const scroll = $('editor-pane').scrollTop;
    ed.innerHTML = '';
    const views = { variables: viewVariables, theme: viewTheme, media: viewMedia, audience: viewAudience, chat: viewChat, outputs: viewOutputs, settings: viewSettings };
    (views[S.tab] || (() => {}))(ed);
    $('editor-pane').scrollTop = scroll;
  }

  /* ---------- Variablen ---------- */
  function viewVariables(ed) {
    const p = S.project;
    const setVar = debounce((name, value) => run('var.set', { name, value }), 200);
    const tv = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Name'), h('th', null, 'Wert'), h('th', { style: { width: '160px' } }, 'Platzhalter'), h('th', { style: { width: '40px' } })));
    for (const [name, value] of Object.entries(p.variables.text)) {
      const nameInp = h('input', { value: name, onchange: () => { if (nameInp.value && nameInp.value !== name) run('var.rename', { from: name, to: nameInp.value }); } });
      const valInp = h('input', { value, oninput: () => setVar(name, valInp.value) });
      tv.appendChild(h('tr', null, h('td', null, nameInp), h('td', null, valInp), h('td', null, h('code', null, `{{${name}}}`)),
        h('td', null, h('button', { class: 'btn xs danger', onclick: () => run('var.set', { name, value: null }) }, '✕'))));
    }
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Text-Variablen', h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: async () => { const n = await UI.prompt('Neue Variable', '', 'Name (ohne Leerzeichen)'); if (n) run('var.set', { name: n, value: '' }); } }, '+ Variable')),
    tv, h('p', { class: 'hint' }, 'Per API setzen: ', h('code', null, `${location.origin}/api/variables/NAME?value=Text`))));

    const lists = h('div');
    for (const [name, l] of Object.entries(p.variables.lists)) {
      const ta = h('textarea', { class: 'inp', rows: 4, oninput: debounce(() => run('list.set', { name, items: ta.value.split('\n').filter((s) => s !== '') }), 300) });
      ta.value = l.items.join('\n');
      const sel = h('select', { class: 'inp', style: { width: 'auto' }, onchange: () => run('list.select', { name, index: Number(sel.value) }) }, l.items.map((it, i) => h('option', { value: i }, `${i + 1}. ${it}`)));
      sel.value = l.index || 0;
      lists.appendChild(h('div', { class: 'card', style: { background: 'var(--bg)' } },
        h('h3', null, h('code', null, `{{${name}}}`), h('span', { class: 'sp' }),
          h('button', { class: 'btn sm', onclick: () => run('list.select', { name, delta: -1 }) }, '◀'), sel,
          h('button', { class: 'btn sm', onclick: () => run('list.select', { name, delta: 1 }) }, '▶'),
          h('button', { class: 'btn xs danger', onclick: () => run('list.set', { name, items: null }) }, '✕')),
        ta, h('p', { class: 'hint' }, 'Aktueller Eintrag: ', h('b', null, l.items[l.index || 0] || '—'), ' · einzelne Einträge: ', h('code', null, `{{${name}[0]}}`), ' · Position ', h('code', null, `{{${name}#}}`), ' · Anzahl ', h('code', null, `{{${name}.count}}`))));
    }
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Listen', h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: async () => { const n = await UI.prompt('Neue Liste', '', 'Name'); if (n) run('list.set', { name: n, items: ['Eintrag 1', 'Eintrag 2'] }); } }, '+ Liste')),
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Listen sind ideal für Gäste, Sprecher:innen oder Sponsoren – durchschalten per Taste oder Companion. API: ', h('code', null, '/api/lists/NAME/next')), lists));

    const sheets = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Name'), h('th', null, 'Tabellen-Link'), h('th', { style: { width: '80px' } }, 'Intervall s'), h('th', null, 'Status'), h('th', { style: { width: '90px' } })));
    for (const s of p.sheets) {
      const upd = debounce((patch) => run('sheet.update', Object.assign({ id: s.id }, patch)), 500);
      const nm = h('input', { value: s.name, oninput: () => upd({ name: nm.value }) });
      const url = h('input', { value: s.url, placeholder: 'https://docs.google.com/spreadsheets/d/…', oninput: () => upd({ url: url.value }) });
      const iv = h('input', { type: 'number', min: 2, value: s.interval, oninput: () => upd({ interval: Number(iv.value) }) });
      const status = s.error ? h('span', { class: 'pill err', title: s.error }, 'Fehler') : s.updated ? h('span', { class: 'pill ok', title: new Date(s.updated).toLocaleTimeString() }, `${(s.cache && s.cache.rows) || 0} Zeilen`) : h('span', { class: 'pill' }, '—');
      sheets.appendChild(h('tr', null, h('td', null, nm), h('td', null, url), h('td', null, iv), h('td', null, status),
        h('td', null, h('button', { class: 'btn xs', onclick: () => run('sheet.refresh', { id: s.id }) }, '↻'), ' ', h('button', { class: 'btn xs danger', onclick: () => run('sheet.remove', { id: s.id }) }, '✕'))));
      if (s.error) sheets.appendChild(h('tr', null, h('td', { colspan: 5, class: 'hint', style: { color: '#ffb3bd' } }, s.error)));
    }
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Google Sheets', h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => run('sheet.add', {}) }, '+ Tabelle')), sheets,
      h('p', { class: 'hint' }, 'Tabelle in Google Sheets über „Teilen → Jeder mit dem Link“ freigeben oder „Datei → Im Web veröffentlichen“ (CSV). Zellen: ', h('code', null, '{{NAME.B2}}'),
        ' · Schlüssel/Wert (Spalte A = Name, Spalte B = Wert): ', h('code', null, '{{NAME.Heimteam}}'), ' · Ein bestimmtes Tabellenblatt über den Link mit #gid=…')));

    const all = Object.entries(S.vars);
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Alle verfügbaren Werte'),
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Eingebaut: ', ...['time', 'time:s', 'date', 'weekday', 'year', 'output', 'project'].map((n) => [h('code', null, `{{${n}}}`), ' ']), '· Fallback: ', h('code', null, '{{name|Standardtext}}')),
      all.length ? h('table', { class: 'tbl' }, all.slice(0, 400).map(([k, v]) => h('tr', null, h('td', { style: { width: '40%' } }, h('code', null, `{{${k}}}`)), h('td', null, v)))) : h('p', { class: 'hint' }, 'Keine Werte.')));
  }

  /* ---------- Theme ---------- */
  const SYSTEM_FONTS = [['Inter, "Helvetica Neue", Arial, sans-serif', 'Inter / Helvetica'], ['Arial, Helvetica, sans-serif', 'Arial'], ['"Segoe UI", Roboto, Arial, sans-serif', 'Segoe UI / Roboto'],
    ['"Arial Narrow", Arial, sans-serif', 'Arial Narrow'], ['Impact, "Arial Black", sans-serif', 'Impact'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times New Roman'],
    ['"Trebuchet MS", Arial, sans-serif', 'Trebuchet'], ['Verdana, sans-serif', 'Verdana'], ['"Courier New", monospace', 'Courier New']];
  function viewTheme(ed) {
    const th = S.project.theme;
    const upd = debounce((patch) => run('theme.update', { theme: patch }), 150);
    const patch = {};
    const set = (k, v) => { patch[k] = v; upd(Object.assign({}, patch)); };
    const presets = h('div', { class: 'row' }, Object.entries(T.THEME_PRESETS).map(([key, p]) =>
      h('button', { class: 'btn' + (th.preset === key ? ' on' : ''), onclick: () => run('theme.preset', { preset: key }), style: { borderLeft: `6px solid ${p.primary}` } }, p.name)));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Vorlagen'), presets, h('p', { class: 'hint' }, 'Eine Vorlage überschreibt Farben, Schriften und Animation. Danach beliebig anpassen.')));
    const fonts = SYSTEM_FONTS.concat(fontNames().map((f) => [`"${f}", sans-serif`, `${f} (hochgeladen)`]));
    if (!fonts.find((f) => f[0] === th.font)) fonts.unshift([th.font, th.font]);
    if (!fonts.find((f) => f[0] === th.headingFont)) fonts.unshift([th.headingFont, th.headingFont]);
    const F = (def) => UI.field(def, th[def.key], (v) => set(def.key, v), env);
    const colors = h('div', { class: 'grid3' }, [
      { key: 'primary', label: 'Primärfarbe', type: 'color' }, { key: 'secondary', label: 'Sekundärfarbe', type: 'color' }, { key: 'accent', label: 'Akzent', type: 'color' },
      { key: 'text', label: 'Text', type: 'color' }, { key: 'textOnPrimary', label: 'Text auf Primärfarbe', type: 'color' }, { key: 'panel', label: 'Panel-Hintergrund (rgba erlaubt)', type: 'color' }].map(F));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Farben'), colors));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Schrift & Form'), h('div', { class: 'grid3' }, [
      { key: 'font', label: 'Fließtext-Schrift', type: 'select', options: fonts }, { key: 'headingFont', label: 'Überschriften-Schrift', type: 'select', options: fonts },
      { key: 'fontScale', label: 'Schriftgröße %', type: 'number', min: 50, max: 250 }, { key: 'radius', label: 'Eckenradius px', type: 'number', min: 0, max: 80 },
      { key: 'shadow', label: 'Schattenstärke (0–1)', type: 'number', min: 0, max: 1, step: 0.05 }, { key: 'safeMargin', label: 'Sicherer Rand px', type: 'number', min: 0, max: 300 },
      { key: 'textShadow', label: 'Textschatten', type: 'toggle' }].map(F)),
    h('p', { class: 'hint' }, 'Eigene Schriften (TTF, OTF, WOFF, WOFF2) im Tab „Medien“ hochladen – sie erscheinen dann hier in der Auswahl.')));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Animation'), h('div', { class: 'grid3' }, [
      { key: 'animation', label: 'Standard-Animation', type: 'select', options: T.ANIMATIONS.filter((a) => a[0] !== 'theme') },
      { key: 'animDuration', label: 'Dauer (ms)', type: 'number', min: 0, max: 5000, step: 50 }].map(F))));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Eigenes CSS'), F({ key: 'customCss', label: 'Gilt für alle Ausgänge. Klassen z. B. .lt, .lt-name, .ticker, .sc-team, .tmr, .msg', type: 'code', rows: 12 })));
  }

  /* ---------- Medien ---------- */
  function viewMedia(ed) {
    const file = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    const prog = h('div');
    const doUpload = async (files) => {
      for (const f of files) {
        const bar = h('i'); const row = h('div', { class: 'hint' }, f.name, h('div', { class: 'progress' }, bar));
        prog.appendChild(row);
        try { await UI.uploadFile(f, (p) => { bar.style.width = (p * 100).toFixed(0) + '%'; }); row.remove(); } catch (e) { toast(e.message, 'err'); row.remove(); }
      }
      reloadMedia();
    };
    file.addEventListener('change', () => doUpload([...file.files]));
    const drop = h('div', { class: 'drop' }, 'Dateien hierher ziehen oder ', h('button', { class: 'btn sm', onclick: () => file.click() }, 'auswählen'), file,
      h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Bilder (PNG, JPG, GIF, WebP, SVG) · Video (MP4, WebM – WebM mit Alpha für transparente Clips) · Audio (MP3, WAV) · Schriften (TTF, OTF, WOFF2)'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); doUpload([...e.dataTransfer.files]); });
    ed.appendChild(drop); ed.appendChild(prog);
    const grid = h('div', { class: 'mgrid' });
    for (const m of S.media) {
      const url = UI.mediaUrl(m.name);
      const prev = m.kind === 'image' ? h('img', { src: url, loading: 'lazy' }) : m.kind === 'video' ? h('video', { src: url + '#t=0.5', muted: true, preload: 'metadata' })
        : m.kind === 'font' ? h('div', { style: { fontFamily: `"${m.name.replace(/\.[^.]+$/, '')}"`, fontSize: '26px', color: 'var(--fg)' } }, 'Aa Bb 123') : (m.kind === 'audio' ? '🔊' : '📄');
      grid.appendChild(h('div', { class: 'mcard' }, h('div', { class: 'mprev' }, prev),
        h('div', { class: 'mi' }, h('span', { title: m.name }, m.name), h('small', { class: 'hint' }, (m.size / 1048576).toFixed(1) + ' MB'),
          h('button', { class: 'btn xs danger', title: 'Löschen', onclick: async () => { if (await UI.confirm('Datei löschen?', m.name, 'Löschen')) { await api('/api/media/' + encodeURIComponent(m.name), { method: 'DELETE' }); reloadMedia(); } } }, '✕'))));
    }
    if (!S.media.length) grid.appendChild(h('div', { class: 'empty' }, 'Noch keine Medien.'));
    ed.appendChild(grid);
    if (fontNames().length) {
      const st = document.getElementById('ctl-fonts') || document.head.appendChild(h('link', { rel: 'stylesheet', id: 'ctl-fonts' }));
      st.href = '/api/fonts.css?' + Date.now();
    }
  }

  /* ---------- Publikum ---------- */
  function qaRow(q, opts = {}) {
    const time = new Date(q.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const acts = [];
    if (q.status === 'pending') {
      acts.push(h('button', { class: 'btn xs ok', title: 'Freigeben (in den Fragenpool)', onclick: () => run('qa.approve', { id: q.id }) }, '✓ Freigeben'));
      acts.push(h('button', { class: 'btn xs danger', title: 'Ablehnen', onclick: () => run('qa.reject', { id: q.id }) }, '✕ Ablehnen'));
    } else if (q.status === 'live') {
      acts.push(h('button', { class: 'btn xs' + (q.active ? ' on-acc' : ''), title: 'Als aktiv markieren (hervorheben)', onclick: () => run('qa.active', { id: q.id }) }, q.active ? '★ Aktiv' : '☆ Aktiv'));
      acts.push(h('button', { class: 'btn xs' + (q.resolved ? ' on' : ''), title: 'Als gelöst markieren (blendet aus)', onclick: () => run('qa.resolve', { id: q.id }) }, q.resolved ? '↺ Wieder offen' : '✓ Gelöst'));
      acts.push(h('button', { class: 'pv', title: 'Einzeln in die Vorschau (Grafik „Publikumsfrage“)', onclick: () => run('qa.show', { id: q.id, live: false }) }, 'PVW'));
      acts.push(h('button', { class: 'lv', title: 'Einzeln sofort auf Sendung (Grafik „Publikumsfrage“)', onclick: () => run('qa.show', { id: q.id }) }, 'LIVE'));
    } else {
      acts.push(h('button', { class: 'btn xs', onclick: () => run('qa.approve', { id: q.id }) }, '✓ Doch freigeben'));
    }
    acts.push(h('button', { class: 'btn xs', title: 'Bearbeiten', onclick: () => editQuestion(q) }, '✎'));
    acts.push(h('button', { class: 'btn xs danger', title: 'Löschen', onclick: () => run('qa.remove', { id: q.id }) }, '🗑'));
    return h('div', { class: `q ${q.status}${q.active ? ' active' : ''}${q.resolved ? ' resolved' : ''}` },
      h('div', { class: 'q-likes', title: 'Likes' }, h('span', null, '▲'), h('b', null, q.likes || 0)),
      h('div', null,
        q.active ? h('span', { class: 'pill warn', style: { marginBottom: '4px', display: 'inline-block' } }, 'AKTIV') : null,
        h('div', { class: 'qt' }, q.text),
        h('div', { class: 'qm' }, `${q.author} · ${time}${q.edited ? ' · bearbeitet' : ''}`,
          (q.flagged || []).length ? h('span', { class: 'pill err', style: { marginLeft: '6px' }, title: 'Sperrwort-Treffer' }, '⚑ ' + q.flagged.join(', ')) : null)),
      h('div', { class: 'qa' }, acts));
  }

  async function editQuestion(q) {
    const ta = h('textarea', { class: 'inp', rows: 4 }); ta.value = q.text;
    const au = h('input', { class: 'inp', value: q.author });
    const m = modal('Frage bearbeiten', h('div', null, h('div', { class: 'field' }, h('label', null, 'Frage'), ta), h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', null, 'Name'), au),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => { run('qa.edit', { id: q.id, text: ta.value, author: au.value }); m.close(); } }, 'Speichern'))), { width: 560 });
  }

  function viewAudience(ed) {
    const p = S.project;
    const qs = p.qaSettings;
    const lan = (S.info && S.info.lan) || [];
    const base = (lan[0] || location.origin);
    const audUrl = base.replace(/\/$/, '') + '/audience';
    const setQs = (patch) => run('qa.settings', patch);
    const sw = (key, label, title) => h('label', { class: 'switch', title: title || '' }, h('input', { type: 'checkbox', checked: !!qs[key], onchange: (e) => setQs({ [key]: e.target.checked }) }), label);
    const titleInp = h('input', { class: 'inp', value: qs.title, oninput: debounce(() => setQs({ title: titleInp.value }), 300) });
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Publikums-Seite'),
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('img', { src: `/api/qr.svg?text=${encodeURIComponent(audUrl)}&border=2`, style: { width: '120px', height: '120px', borderRadius: '6px', background: '#fff' } }),
        h('div', { class: 'grow' },
          h('div', { class: 'row' }, h('div', { class: 'copy' }, audUrl), h('button', { class: 'btn sm', onclick: () => copyText(audUrl) }, 'Kopieren'), h('button', { class: 'btn sm', onclick: () => window.open('/audience', '_blank') }, 'Öffnen ↗')),
          h('div', { class: 'grid2', style: { marginTop: '10px' } },
            h('div', { class: 'field' }, h('label', null, 'Platzhalter im Fragefeld'), titleInp),
            h('div', { class: 'field' }, h('label', null, 'Maximale Länge (Zeichen)'), h('input', { class: 'inp', type: 'number', min: 20, max: 2000, value: qs.maxLength, onchange: (e) => setQs({ maxLength: Number(e.target.value) }) }))),
          h('div', { class: 'row', style: { marginTop: '10px', gap: '16px' } },
            sw('open', 'Fragen erlaubt'), sw('moderation', 'Fragen vor Freigabe prüfen', 'Neue Fragen landen zuerst unter „Prüfen“'),
            sw('allowLikes', 'Likes erlaubt'), sw('showQuestions', 'Publikum sieht Fragenliste'), sw('requireName', 'Name Pflicht')),
          h('p', { class: 'hint' }, 'Tipp: Grafik „Q&A live“ mit QR-Code einblenden oder im QR-Code-Grafiktyp ', h('code', null, '{{audience_url}}'), ' verwenden.')))));

    // Sperrwörter
    const bw = h('textarea', { class: 'inp code', rows: 4, placeholder: 'ein Wort pro Zeile, z. B.\nidiot\nscheiß*\n*werbung*' });
    bw.value = qs.blockedWords || '';
    bw.addEventListener('input', debounce(() => setQs({ blockedWords: bw.value }), 500));
    const act = h('select', { class: 'inp', style: { width: 'auto' }, onchange: () => setQs({ blockedAction: act.value }) },
      h('option', { value: 'moderate' }, 'Zur Prüfung zurückhalten'), h('option', { value: 'reject' }, 'Automatisch ablehnen'), h('option', { value: 'censor' }, 'Wort durch *** ersetzen'));
    act.value = qs.blockedAction || 'moderate';
    const testIn = h('input', { class: 'inp', placeholder: 'Testsatz eingeben …' });
    const testOut = h('span', { class: 'hint' });
    testIn.addEventListener('input', debounce(async () => {
      if (!testIn.value) { testOut.textContent = ''; return; }
      try { const r = await cmd('qa.test', { text: testIn.value, list: bw.value }); testOut.textContent = r.hits.length ? `Treffer: ${r.hits.join(', ')} → „${r.censored}“` : 'Kein Treffer'; } catch (_) {}
    }, 250));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Sperrwörter'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', null, 'Gesperrte Wörter (auch für Wortwolken)'), bw),
        h('div', null,
          h('div', { class: 'field' }, h('label', null, 'Bei Treffer'), act),
          h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', null, 'Ausprobieren'), testIn), testOut)),
      h('p', { class: 'hint' }, 'Groß-/Kleinschreibung, Umlaute und Schreibweisen wie „1d10t“ werden erkannt. ', h('code', null, 'wort'), ' = ganzes Wort · ', h('code', null, 'wort*'), ' = Wortanfang · ', h('code', null, '*wort*'), ' = irgendwo im Wort.')));

    // Fragen
    const pending = p.questions.filter((q) => q.status === 'pending');
    const liveOpen = p.questions.filter((q) => q.status === 'live' && !q.resolved);
    const resolved = p.questions.filter((q) => q.status === 'live' && q.resolved);
    const rejected = p.questions.filter((q) => q.status === 'rejected');
    if (!['pending', 'live', 'resolved', 'rejected'].includes(S.qaFilter)) S.qaFilter = pending.length ? 'pending' : 'live';
    const sortSel = h('select', { class: 'inp', style: { width: 'auto', padding: '3px 6px' }, onchange: () => { S.qaSort = sortSel.value; renderTab(true); } },
      h('option', { value: 'likes' }, 'Beliebteste'), h('option', { value: 'newest' }, 'Neueste'), h('option', { value: 'oldest' }, 'Älteste'));
    sortSel.value = S.qaSort || 'likes';
    const filters = [['pending', `Prüfen (${pending.length})`], ['live', `Live (${liveOpen.length})`], ['resolved', `Gelöst (${resolved.length})`], ['rejected', `Abgelehnt (${rejected.length})`]];
    const lists = { pending, live: liveOpen, resolved, rejected };
    const sorter = { likes: (a, b) => (b.likes - a.likes) || (a.ts - b.ts), newest: (a, b) => b.ts - a.ts, oldest: (a, b) => a.ts - b.ts }[sortSel.value];
    let shown = lists[S.qaFilter].slice().sort(S.qaFilter === 'pending' ? (a, b) => a.ts - b.ts : sorter);
    if (S.qaFilter === 'live') { const a = shown.find((q) => q.active); if (a) shown = [a].concat(shown.filter((q) => q !== a)); }
    const qlist = h('div', { class: 'qlist' }, shown.length ? shown.map((q) => qaRow(q)) : h('div', { class: 'empty' }, { pending: 'Keine Fragen zu prüfen.', live: 'Keine offenen Fragen.', resolved: 'Noch nichts gelöst.', rejected: 'Nichts abgelehnt.' }[S.qaFilter]));
    const active = p.questions.find((q) => q.active);
    const bulk = [];
    if (S.qaFilter === 'pending' && pending.length) bulk.push(h('button', { class: 'btn xs ok', onclick: () => run('qa.approveAll') }, 'Alle freigeben (ohne Sperrwort-Treffer)'));
    if (S.qaFilter === 'resolved' && resolved.length) bulk.push(h('button', { class: 'btn xs danger', onclick: async () => { if (await UI.confirm('Gelöste Fragen löschen?', 'Gelöste und abgelehnte Fragen werden entfernt.', 'Löschen')) run('qa.clear', { scope: 'resolved' }); } }, 'Gelöste löschen'));
    if (S.qaFilter === 'rejected' && rejected.length) bulk.push(h('button', { class: 'btn xs danger', onclick: () => run('qa.clear', { scope: 'rejected' }) }, 'Abgelehnte löschen'));
    ed.appendChild(h('div', { class: 'card' },
      h('h3', null, 'Fragen', h('span', { class: 'sp' }), sortSel,
        h('button', { class: 'btn xs', onclick: async () => {
          let g = S.project.graphics.find((x) => x.type === 'qawall');
          if (!g) { const r = await cmd('graphic.add', { type: 'qawall', name: 'Q&A live' }); g = { id: r.id }; }
          select(g.id);
        } }, 'Q&A-Grafik')),
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        ...filters.map(([k, l]) => h('button', { class: 'btn sm' + (S.qaFilter === k ? ' on' : ''), onclick: () => { S.qaFilter = k; renderTab(true); } }, l)),
        h('span', { class: 'grow' }), ...bulk),
      h('div', { class: 'qa-now' },
        h('span', null, active ? h('b', null, 'Aktiv: ') : 'Keine aktive Frage', active ? active.text.slice(0, 90) + (active.text.length > 90 ? '…' : '') : ''),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn sm primary', title: 'Aktive Frage als gelöst markieren und nächste (beliebteste) aktivieren', onclick: () => run('qa.activeNext', { sort: S.qaSort || 'likes' }) }, 'Nächste Frage ▶'),
        active ? h('button', { class: 'btn sm', onclick: () => run('qa.resolveActive') }, '✓ Aktive gelöst') : null),
      qlist));

    // Umfragen
    const typeLabel = { choice: 'Auswahl', multi: 'Mehrfachauswahl', wordcloud: 'Wortwolke', rating: 'Bewertung' };
    const polls = h('div');
    for (const poll of p.polls) {
      const q = h('input', { class: 'inp', value: poll.question, oninput: debounce(() => run('poll.update', { id: poll.id, question: q.value }), 300) });
      const typeSel = h('select', { class: 'inp', style: { width: 'auto' }, onchange: async () => { if (await UI.confirm('Umfragetyp ändern?', 'Bisherige Ergebnisse werden zurückgesetzt.', 'Ändern')) run('poll.update', { id: poll.id, type: typeSel.value }); else typeSel.value = poll.type; } },
        Object.entries(typeLabel).map(([v, l]) => h('option', { value: v }, l)));
      typeSel.value = poll.type;
      let cfg = null, results = null;
      const total = poll.type === 'rating' ? poll.ratings.reduce((a, b) => a + b, 0) : poll.type === 'wordcloud' ? Object.values(poll.words).reduce((a, w) => a + w.count, 0) : poll.options.reduce((a, o) => a + o.votes, 0);
      if (poll.type === 'choice' || poll.type === 'multi') {
        const opts = h('textarea', { class: 'inp', rows: Math.max(3, poll.options.length) });
        opts.value = poll.options.map((o) => o.text).join('\n');
        opts.addEventListener('input', debounce(() => run('poll.update', { id: poll.id, options: opts.value.split('\n').map((x) => x.trim()).filter(Boolean) }), 500));
        cfg = h('div', null, h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', null, 'Antworten (eine pro Zeile)'), opts),
          poll.type === 'multi' ? h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', null, 'Höchstens wählbar'), h('input', { class: 'inp', type: 'number', min: 1, max: 20, value: poll.maxChoices, onchange: (e) => run('poll.update', { id: poll.id, maxChoices: Number(e.target.value) }) })) : null);
        const baseN = poll.type === 'multi' ? Math.max(1, poll.respondents || 0) : Math.max(1, total);
        results = h('div', { class: 'bars' }, poll.options.map((o) => {
          const pct = total ? Math.round(o.votes / baseN * 100) : 0;
          return h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } }), h('span', null, h('span', null, o.text), h('b', null, `${o.votes} · ${pct} %`)));
        }), h('div', { class: 'hint' }, poll.type === 'multi' ? `${poll.respondents || 0} Teilnehmende · ${total} Stimmen` : `${total} Stimmen`));
      } else if (poll.type === 'rating') {
        cfg = h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', null, 'Skala (Sterne)'), h('input', { class: 'inp', type: 'number', min: 2, max: 10, value: poll.scale, onchange: (e) => run('poll.update', { id: poll.id, scale: Number(e.target.value) }) }));
        const sum = poll.ratings.reduce((a, n, i) => a + n * (i + 1), 0);
        results = h('div', { class: 'bars' }, h('div', { style: { fontSize: '26px', fontWeight: 800 } }, total ? (sum / total).toFixed(1).replace('.', ',') + ' ★' : '–'),
          poll.ratings.map((n, i) => ({ n, i })).reverse().map(({ n, i }) => h('div', { class: 'bar' }, h('i', { style: { width: (total ? n / total * 100 : 0) + '%' } }), h('span', null, h('span', null, `${i + 1} ★`), h('b', null, n)))),
          h('div', { class: 'hint' }, `${total} Stimmen`));
      } else {
        cfg = h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', null, 'Begriffe pro Person'), h('input', { class: 'inp', type: 'number', min: 1, max: 10, value: poll.maxWords, onchange: (e) => run('poll.update', { id: poll.id, maxWords: Number(e.target.value) }) }));
        const words = Object.entries(poll.words).filter(([, w]) => w.count > 0).sort((a, b) => b[1].count - a[1].count);
        results = h('div', null, h('div', { class: 'chips' }, words.length ? words.slice(0, 80).map(([k, w]) => h('span', { class: 'chip' }, `${w.text} · ${w.count}`, h('button', { title: 'Begriff entfernen', onclick: () => run('poll.removeWord', { id: poll.id, word: k }) }, '✕'))) : h('span', { class: 'hint' }, 'Noch keine Begriffe.')),
          h('div', { class: 'hint', style: { marginTop: '6px' } }, `${total} Begriffe · ${poll.respondents || 0} Teilnehmende`));
      }
      polls.appendChild(h('div', { class: 'card', style: { background: 'var(--bg)' } },
        h('h3', null, poll.open ? h('span', { class: 'pill ok' }, 'OFFEN') : h('span', { class: 'pill' }, 'geschlossen'), h('span', { class: 'pill' }, typeLabel[poll.type]), h('span', { class: 'sp' }),
          h('label', { class: 'switch', title: 'Publikum sieht Ergebnisse' }, h('input', { type: 'checkbox', checked: poll.showResults, onchange: (e) => run('poll.update', { id: poll.id, showResults: e.target.checked }) }), 'Ergebnisse fürs Publikum'),
          h('button', { class: 'btn sm' + (poll.open ? '' : ' primary'), onclick: () => run('poll.update', { id: poll.id, open: !poll.open }) }, poll.open ? 'Schließen' : 'Öffnen'),
          h('button', { class: 'btn sm', onclick: async () => {
            let g = S.project.graphics.find((x) => x.type === 'poll' && x.data.pollId === poll.id);
            if (!g) { const r = await cmd('graphic.add', { type: 'poll', name: 'Umfrage: ' + poll.question.slice(0, 30), data: { pollId: poll.id } }); g = { id: r.id }; }
            select(g.id);
          } }, 'Grafik'),
          h('button', { class: 'btn sm', onclick: () => run('poll.reset', { id: poll.id }) }, 'Zurücksetzen'),
          h('button', { class: 'btn xs danger', onclick: async () => { if (await UI.confirm('Umfrage löschen?', poll.question, 'Löschen')) run('poll.remove', { id: poll.id }); } }, '✕')),
        h('div', { class: 'grid2' },
          h('div', null, h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('label', null, 'Frage'), q), h('div', { class: 'field' }, h('label', null, 'Typ'), typeSel)), cfg),
          results)));
    }
    if (!p.polls.length) polls.appendChild(h('div', { class: 'empty' }, 'Noch keine Umfragen.'));
    const add = (type, label) => h('button', { class: 'btn sm', onclick: () => run('poll.create', { question: { choice: 'Neue Umfrage', multi: 'Was interessiert dich?', wordcloud: 'Beschreibe es in einem Wort', rating: 'Wie hat es dir gefallen?' }[type], type, options: type === 'choice' ? ['Ja', 'Nein'] : type === 'multi' ? ['Option A', 'Option B', 'Option C'] : [] }) }, label);
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Umfragen', h('span', { class: 'sp' }), add('choice', '+ Auswahl'), add('multi', '+ Mehrfachauswahl'), add('wordcloud', '+ Wortwolke'), add('rating', '+ Bewertung')), polls));
  }

  /* ---------- Chat ---------- */
  let chatBox = null;
  function chatRow(m) {
    return h('div', { class: 'cm', style: { '--nc': m.color || '#9ab' } },
      h('div', null, h('b', { style: { color: m.color || '' } }, m.author), ': ', m.text),
      h('div', { class: 'ca' },
        h('button', { class: 'pv', onclick: () => run('chat.show', { msgId: m.id, live: false }) }, 'PVW'),
        h('button', { class: 'lv', onclick: () => run('chat.show', { msgId: m.id }) }, 'LIVE')));
  }
  function appendChat(m) {
    const box = $('chat-box'); if (!box) return;
    const atTop = box.scrollTop < 20;
    box.prepend(chatRow(m));
    while (box.childNodes.length > 300) box.lastChild.remove();
    if (atTop) box.scrollTop = 0;
  }
  function viewChat(ed) {
    const ch = h('input', { class: 'inp', style: { width: '260px' }, value: S.chatChannel, placeholder: 'Twitch-Kanal (z. B. meinkanal)' });
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Twitch-Chat'),
      h('div', { class: 'row' }, ch,
        h('button', { class: 'btn primary sm', onclick: () => run('chat.connect', { channel: ch.value }) }, 'Verbinden'),
        h('button', { class: 'btn sm', onclick: () => run('chat.disconnect') }, 'Trennen'),
        h('span', { class: 'pill', id: 'chat-status' }, S.chatStatus)),
      h('p', { class: 'hint' }, 'Liest den öffentlichen Chat anonym mit – kein Login nötig. Eine Nachricht mit LIVE/PVW in die Grafik „Social / Chat“ übernehmen. Für YouTube, Instagram & Co. die Grafik „Social / Chat“ manuell befüllen.')));
    chatBox = h('div', { class: 'chat', id: 'chat-box' });
    for (const m of S.chat.slice().reverse()) chatBox.appendChild(chatRow(m));
    if (!S.chat.length) chatBox.appendChild(h('div', { class: 'empty' }, 'Noch keine Nachrichten.'));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Nachrichten'), chatBox));
  }

  /* ---------- Ausgänge ---------- */
  function outUrl(id) { return `${location.origin}/output/${id}`; }
  function viewOutputs(ed) {
    const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', { style: { width: '30px' } }, '#'), h('th', null, 'Name'), h('th', null, 'Hintergrund'), h('th', { style: { width: '70px' } }, 'Ton'), h('th', null, 'URL (OBS / vMix / Browser)'), h('th', { style: { width: '120px' } })));
    const bgOpts = [['transparent', 'Transparent (Alpha)'], ['#00ff00', 'Grün (Chroma-Key)'], ['#0000ff', 'Blau (Chroma-Key)'], ['#000000', 'Schwarz (Luma-Key)'], ['#ffffff', 'Weiß']];
    for (const o of outputs()) {
      const upd = debounce((patch) => run('output.update', Object.assign({ id: o.id }, patch)), 300);
      const nm = h('input', { value: o.name, oninput: () => upd({ name: nm.value }) });
      const bg = h('select', { onchange: () => run('output.update', { id: o.id, background: bg.value }) }, bgOpts.map(([v, l]) => h('option', { value: v }, l)));
      if (!bgOpts.find((b) => b[0] === o.background)) bg.appendChild(h('option', { value: o.background }, o.background));
      bg.value = o.background || 'transparent';
      tbl.appendChild(h('tr', null, h('td', null, h('b', null, o.id)), h('td', null, nm), h('td', null, bg),
        h('td', null, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!o.audio, onchange: (e) => run('output.update', { id: o.id, audio: e.target.checked }) }))),
        h('td', null, h('div', { class: 'row' }, h('div', { class: 'copy' }, outUrl(o.id)), h('button', { class: 'btn xs', onclick: () => copyText(outUrl(o.id)) }, 'Kopieren'))),
        h('td', null, h('button', { class: 'btn xs', onclick: () => openOutput(o.id) }, 'Öffnen ↗'), ' ',
          o.id !== '1' ? h('button', { class: 'btn xs danger', onclick: async () => { if (await UI.confirm('Ausgang entfernen?', o.name, 'Entfernen')) run('output.remove', { id: o.id }); } }, '✕') : null)));
    }
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Grafik-Ausgänge', h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => run('output.add', {}) }, '+ Ausgang')), tbl,
      h('p', { class: 'hint' }, 'OBS: Browser-Quelle mit 1920×1080 und dieser URL. vMix: Input → Web Browser. ATEM: Ausgang mit Grün/Schwarz auf einen Monitor- oder DeckLink-Ausgang legen und keyen. Zusatzparameter: ',
        h('code', null, '?transparent=1'), ' ', h('code', null, '?bg=%2300ff00'), ' ', h('code', null, '?audio=0'), ' ', h('code', null, '?guides=1'), '. Vorschau-Ausgang: ', h('code', null, '/output/preview'))));

    // Bildschirm-Ausgänge
    const ds = S.hw && S.hw.displays;
    const dsCard = h('div', { class: 'card' }, h('h3', null, 'Bildschirm-Ausgänge (HDMI / DisplayPort / Beamer)'));
    if (!ds || !ds.available) dsCard.appendChild(h('p', { class: 'hint' }, 'Nur in der Desktop-App verfügbar. Im Browser: Ausgang öffnen und mit F11 in den Vollbildmodus schalten.'));
    else {
      if (!S.dsDraft) S.dsDraft = JSON.parse(JSON.stringify(ds.outputs || []));
      const t2 = h('table', { class: 'tbl' }, h('tr', null, h('th', { style: { width: '60px' } }, 'Aktiv'), h('th', null, 'Bildschirm'), h('th', null, 'Grafik-Ausgang'), h('th', { style: { width: '40px' } })));
      S.dsDraft.forEach((d, i) => {
        const scr = h('select', { onchange: () => { d.displayId = scr.value; } }, ds.displays.map((x) => h('option', { value: String(x.id) }, x.label)));
        scr.value = String(d.displayId);
        const out = h('select', { onchange: () => { d.output = out.value; } }, outputs().map((o) => h('option', { value: o.id }, `${o.id} · ${o.name}`)));
        out.value = d.output;
        t2.appendChild(h('tr', null, h('td', null, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: d.enabled, onchange: (e) => { d.enabled = e.target.checked; } }))),
          h('td', null, scr), h('td', null, out), h('td', null, h('button', { class: 'btn xs danger', onclick: () => { S.dsDraft.splice(i, 1); renderTab(true); } }, '✕'))));
      });
      dsCard.append(t2, h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: () => { S.dsDraft.push({ id: 'd' + Date.now(), enabled: true, displayId: String((ds.displays.find((x) => !x.primary) || ds.displays[0] || {}).id), output: '1' }); renderTab(true); } }, '+ Bildschirm'),
        h('button', { class: 'btn sm', onclick: () => api('/api/displays/identify', { method: 'POST' }) }, 'Bildschirme identifizieren'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary sm', onclick: async () => { try { await api('/api/displays/config', { method: 'POST', body: JSON.stringify({ outputs: S.dsDraft }) }); S.dsDraft = null; toast('Bildschirm-Ausgänge übernommen', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Übernehmen')));
    }
    ed.appendChild(dsCard);
    ed.appendChild(ndiCard());
    ed.appendChild(decklinkCard());
  }

  function ndiCard() {
    const nd = S.hw && S.hw.ndi;
    const card = h('div', { class: 'card' }, h('h3', null, 'NDI-Ausgänge'));
    if (!nd || !nd.available) { card.appendChild(h('p', { class: 'hint' }, (nd && nd.reason) || 'Nicht verfügbar.')); return card; }
    const libInp = h('input', { class: 'inp', style: { flex: '1', minWidth: '220px' }, value: nd.libPath || '', placeholder: nd.runtime ? nd.runtimePath : 'z. B. /Applications/NDI Video Monitor.app/Contents/Frameworks/libndi_advanced.dylib' });
    const libRow = h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: 'hint' }, 'NDI-Bibliothek:'), libInp,
      h('button', { class: 'btn sm', onclick: async () => { try { const r = await api('/api/ndi/pick', { method: 'POST', body: '{}' }); if (r.picked) toast(r.runtime ? 'NDI-Laufzeit geladen' : (r.reason || 'Nicht ladbar'), r.runtime ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } }, 'Datei wählen …'),
      h('button', { class: 'btn sm', onclick: async () => { try { const r = await api('/api/ndi/library', { method: 'POST', body: JSON.stringify({ path: libInp.value }) }); toast(r.runtime ? 'NDI-Laufzeit geladen' : (r.reason || 'Nicht gefunden'), r.runtime ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } }, 'Übernehmen'));
    if (!nd.runtime) {
      card.appendChild(h('p', { class: 'hint', style: { color: '#ffd27a', marginTop: 0, whiteSpace: 'pre-wrap' } }, nd.reason || 'NDI-Laufzeit nicht gefunden.', ' ', h('a', { href: 'https://ndi.video/tools/', target: '_blank' }, 'NDI Tools laden')));
      card.appendChild(libRow);
      if ((nd.searched || []).length) card.appendChild(h('details', { class: 'hint', style: { marginBottom: '10px' } }, h('summary', null, `Durchsuchte Orte (${nd.searched.length})`), h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px' } }, nd.searched.join('\n'))));
    } else {
      card.appendChild(h('p', { class: 'hint', style: { marginTop: 0 } }, `NDI-Laufzeit ${nd.runtimeVersion || ''} · ${nd.runtimePath || ''} · Quellen erscheinen im Netzwerk als „${nd.host} (Name)“`));
    }
    if (!S.ndiDraft) S.ndiDraft = JSON.parse(JSON.stringify(nd.outputs || []));
    const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', { style: { width: '50px' } }, 'Aktiv'), h('th', null, 'NDI-Name'), h('th', null, 'Grafik-Ausgang'), h('th', null, 'Auflösung'), h('th', null, 'Bildrate'), h('th', null, 'Alpha'), h('th', { style: { width: '60px' } }, 'Ton'), h('th', null, 'Status'), h('th', { style: { width: '36px' } })));
    S.ndiDraft.forEach((o, i) => {
      const st = (nd.status || {})[o.id] || {};
      const name = h('input', { value: o.name, oninput: () => { o.name = name.value; } });
      const out = h('select', { onchange: () => { o.output = out.value; } }, outputs().map((x) => h('option', { value: x.id }, `${x.id} · ${x.name}`)));
      out.value = o.output || '1';
      const res = h('select', { onchange: () => { o.resolution = res.value; } }, [['1080', '1920×1080'], ['720', '1280×720'], ['2160', '3840×2160 (4K)'], ['1080v', '1080×1920 (Hochformat)']].map(([v, l]) => h('option', { value: v }, l)));
      res.value = o.resolution || '1080';
      const fps = h('select', { onchange: () => { o.fps = fps.value; } }, ['25', '29.97', '30', '50', '59.94', '60'].map((v) => h('option', { value: v }, v)));
      fps.value = o.fps || '50';
      const alpha = h('select', { onchange: () => { o.alpha = alpha.value === '1'; } }, h('option', { value: '1' }, 'Transparent'), h('option', { value: '0' }, 'Deckend (Hintergrund)'));
      alpha.value = o.alpha === false ? '0' : '1';
      let status;
      if (st.running) status = h('span', { class: 'pill ok', title: `${st.sent || 0} Bilder gesendet · Render ${st.renderFps || 0} fps` }, `läuft · ${st.connections || 0} Empfänger${st.tallyProgram ? ' · PGM' : st.tallyPreview ? ' · PVW' : ''}`);
      else if (st.error) status = h('span', { class: 'pill err', title: st.error }, 'Fehler');
      else status = h('span', { class: 'pill' }, o.enabled ? 'gestoppt' : 'aus');
      tbl.appendChild(h('tr', null,
        h('td', null, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: o.enabled !== false, onchange: (e) => { o.enabled = e.target.checked; } }))),
        h('td', null, name), h('td', null, out), h('td', null, res), h('td', null, fps), h('td', null, alpha),
        h('td', null, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!o.audio, onchange: (e) => { o.audio = e.target.checked; } }))),
        h('td', null, status),
        h('td', null, h('button', { class: 'btn xs danger', onclick: () => { S.ndiDraft.splice(i, 1); renderTab(true); } }, '✕'))));
      if (st.error) tbl.appendChild(h('tr', null, h('td', { colspan: 9, class: 'hint', style: { color: '#ffb3bd' } }, st.error)));
    });
    card.appendChild(tbl);
    card.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn sm', onclick: () => {
        const n = S.ndiDraft.length + 1;
        const o = outputs()[Math.min(S.ndiDraft.length, outputs().length - 1)] || { id: '1', name: 'Hauptausgang' };
        S.ndiDraft.push({ id: 'ndi' + Date.now().toString(36), enabled: true, name: `CueGFX ${o.name || n}`, output: o.id, resolution: '1080', fps: '50', alpha: true, audio: false });
        renderTab(true);
      } }, '+ NDI-Ausgang'),
      h('button', { class: 'btn sm', onclick: () => { S.ndiDraft = null; renderTab(true); } }, 'Verwerfen'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: async () => {
        try { await api('/api/ndi/config', { method: 'POST', body: JSON.stringify({ outputs: S.ndiDraft }) }); S.ndiDraft = null; toast('NDI-Ausgänge übernommen', 'ok'); renderTab(true); } catch (e) { toast(e.message, 'err'); }
      } }, 'Übernehmen & starten')));
    card.appendChild(h('p', { class: 'hint' }, 'Jeder Grafik-Ausgang kann als eigene NDI-Quelle gesendet werden – z. B. in vMix, OBS (DistroAV), TriCaster, ATEM über NDI-Konverter oder NDI Studio Monitor. „Transparent“ sendet mit Alphakanal (Key in vMix/OBS automatisch). Die Grafik-Ausgabe läuft mit fester Bildrate; auch unveränderte Bilder werden gesendet, damit Empfänger stabil bleiben.'));
    return card;
  }

  function decklinkCard() {
    const dl = S.hw && S.hw.decklink;
    const card = h('div', { class: 'card' }, h('h3', null, 'Blackmagic DeckLink / UltraStudio', h('span', { class: 'sp' }),
      dl && dl.available ? h('button', { class: 'btn sm', onclick: async () => { await api('/api/decklink/rescan', { method: 'POST' }); toast('Geräte neu gesucht'); } }, '↻ Geräte suchen') : null));
    if (!dl || !dl.available) {
      card.appendChild(h('p', { class: 'hint' }, (dl && dl.reason) || 'Nicht verfügbar.'));
      return card;
    }
    if (dl.sdkVersion) card.appendChild(h('p', { class: 'hint', style: { marginTop: 0 } }, `Treiber/API: ${dl.driverVersion || '?'} · gebaut mit SDK ${dl.sdkVersion}`));
    const devs = dl.devices || [];
    if (!devs.length) card.appendChild(h('p', { class: 'hint' }, 'Keine DeckLink-/UltraStudio-Geräte gefunden. Desktop Video installiert und Gerät verbunden?'));
    else card.appendChild(h('table', { class: 'tbl', style: { marginBottom: '12px' } }, h('tr', null, h('th', null, 'Gerät'), h('th', null, 'Ein/Aus'), h('th', null, 'Keyer')),
      devs.map((d) => h('tr', null, h('td', null, h('b', null, d.name), d.model && d.model !== d.name ? h('div', { class: 'hint' }, d.model) : null),
        h('td', null, [d.canOutput ? 'Ausgabe' : null, d.canInput ? 'Eingang' : null].filter(Boolean).join(' · ')),
        h('td', null, [d.externalKeying ? 'Extern (Fill+Key)' : null, d.internalKeying ? 'Intern' : null].filter(Boolean).join(' · ') || '—')))));
    if (!S.dlDraft) S.dlDraft = JSON.parse(JSON.stringify(dl.outputs || []));
    const outDevs = devs.filter((d) => d.canOutput), inDevs = devs.filter((d) => d.canInput);
    S.dlDraft.forEach((o, i) => {
      const dev = devs.find((d) => d.key === o.deviceKey);
      const st = (dl.status || {})[o.id] || {};
      const devSel = h('select', { class: 'inp', onchange: () => { o.deviceKey = devSel.value; o.modeId = ''; renderTab(true); } },
        h('option', { value: '' }, '— Gerät wählen —'), outDevs.map((d) => h('option', { value: d.key }, d.name)));
      devSel.value = o.deviceKey || '';
      const modes = dev ? dev.outputModes : [];
      const modeSel = h('select', { class: 'inp', onchange: () => { o.modeId = modeSel.value; } }, h('option', { value: '' }, '— Format —'), modes.map((m) => h('option', { value: m.id }, m.name)));
      modeSel.value = o.modeId || '';
      const keyOpts = [['none', 'Nur Fill (Hintergrund aus Ausgang)']];
      if (!dev || dev.externalKeying) keyOpts.push(['external', 'Fill + Key (2 Ausgänge, externer Keyer)']);
      if (!dev || dev.internalKeying) keyOpts.push(['internal', 'Interner Keyer (über SDI-Eingang der Karte)']);
      keyOpts.push(['software', 'Live-Eingang als Hintergrund (Software)']);
      const keySel = h('select', { class: 'inp', onchange: () => { o.keying = keySel.value; renderTab(true); } }, keyOpts.map(([v, l]) => h('option', { value: v }, l)));
      keySel.value = o.keying || 'none';
      const outSel = h('select', { class: 'inp', onchange: () => { o.output = outSel.value; } }, outputs().map((x) => h('option', { value: x.id }, `${x.id} · ${x.name}`)));
      outSel.value = o.output || '1';
      const inSel = h('select', { class: 'inp', onchange: () => { o.inputDeviceKey = inSel.value; } }, h('option', { value: '' }, '— Eingang wählen —'), inDevs.map((d) => h('option', { value: d.key }, d.name)));
      inSel.value = o.inputDeviceKey || '';
      const alphaSel = h('select', { class: 'inp', onchange: () => { o.alpha = alphaSel.value; } }, h('option', { value: 'premultiplied' }, 'Premultiplied (Shaped)'), h('option', { value: 'straight' }, 'Straight (Unshaped)'));
      alphaSel.value = o.alpha || 'premultiplied';
      const pfSel = h('select', { class: 'inp', onchange: () => { o.pixelFormat = pfSel.value; } }, h('option', { value: 'auto' }, 'Automatisch (empfohlen)'), h('option', { value: 'bgra' }, '8-Bit BGRA'), h('option', { value: 'argb' }, '8-Bit ARGB'), h('option', { value: 'yuv' }, '8-Bit YUV (ohne Key)'));
      pfSel.value = o.pixelFormat || 'auto';
      const omSel = h('select', { class: 'inp', onchange: () => { o.outputMode = omSel.value; } }, h('option', { value: 'auto' }, 'Automatisch (Scheduled, Rückfall auf direkt)'), h('option', { value: 'sync' }, 'Direkt (synchron)'));
      omSel.value = o.outputMode || 'auto';
      const lvl = h('input', { type: 'number', class: 'inp', min: 0, max: 255, value: o.keyLevel === undefined ? 255 : o.keyLevel, oninput: () => { o.keyLevel = Number(lvl.value); } });
      const statusPill = st.running ? h('span', { class: 'pill ok' }, `läuft · ${st.width}×${st.height} @ ${st.fps}`) : st.error ? h('span', { class: 'pill err', title: st.error }, 'Fehler') : h('span', { class: 'pill' }, o.enabled ? 'gestoppt' : 'aus');
      const extra = [];
      const modeTxt = { scheduled: 'Scheduled', sync: 'Direkt', 'sync-fallback': 'Direkt (automatischer Rückfall)' }[st.outputMode] || '';
      if (st.running) extra.push(`Verfahren ${modeTxt || '–'} · Pixelformat ${st.pixelFormat || '–'} · an Karte ${st.frames || 0} Frames · Grafik-Bilder ${st.pushed || 0} · Render ${st.renderFps || 0} fps${st.captureMode ? ' (Bildabgriff)' : ''} · verspätet ${st.late || 0} · verworfen ${st.dropped || 0}`);
      if (st.running && !st.pushed) extra.push('⚠ Es kommen noch keine Grafik-Bilder an – ist eine Grafik auf diesem Ausgang LIVE?');
      if (o.keying === 'software') extra.push(`Eingang: ${st.inputSignal ? (st.inputMode || 'Signal') : 'kein Signal'}`);
      card.appendChild(h('div', { class: 'card', style: { background: 'var(--bg)' } },
        h('h3', null, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: o.enabled, onchange: (e) => { o.enabled = e.target.checked; } }), `DeckLink-Ausgabe ${i + 1}`), statusPill, h('span', { class: 'sp' }),
          h('button', { class: 'btn xs danger', onclick: () => { S.dlDraft.splice(i, 1); renderTab(true); } }, '✕')),
        st.error ? h('p', { class: 'hint', style: { color: '#ffb3bd', marginTop: 0 } }, st.error) : null,
        h('div', { class: 'grid3' },
          h('div', { class: 'field' }, h('label', null, 'Gerät / Ausgang'), devSel),
          h('div', { class: 'field' }, h('label', null, 'Videoformat'), modeSel),
          h('div', { class: 'field' }, h('label', null, 'Grafik-Ausgang'), outSel),
          h('div', { class: 'field' }, h('label', null, 'Keying'), keySel),
          o.keying === 'software' ? h('div', { class: 'field' }, h('label', null, 'Live-Eingang (Gerät)'), inSel) : null,
          o.keying === 'external' || o.keying === 'internal' ? h('div', { class: 'field' }, h('label', null, 'Key-Level (0–255)'), lvl) : null,
          h('div', { class: 'field' }, h('label', null, 'Alpha'), alphaSel),
          h('div', { class: 'field' }, h('label', null, 'Pixelformat'), pfSel),
          h('div', { class: 'field' }, h('label', null, 'Ausgabeverfahren'), omSel),
          h('div', { class: 'field' }, h('label', { class: 'switch', style: { marginTop: '18px' } }, h('input', { type: 'checkbox', checked: !!o.swapRB, onchange: (e) => { o.swapRB = e.target.checked; } }), 'Rot/Blau tauschen')),
          h('div', { class: 'field' }, h('label', { class: 'switch', style: { marginTop: '18px' } }, h('input', { type: 'checkbox', checked: !!o.localAudio, onchange: (e) => { o.localAudio = e.target.checked; } }), 'Ton über Computer ausgeben'))),
        extra.length ? h('p', { class: 'hint' }, extra.join(' · ')) : null));
    });
    card.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => {
        const used = new Set(S.dlDraft.map((x) => x.deviceKey));
        const free = outDevs.find((d) => !used.has(d.key)) || outDevs[0];
        S.dlDraft.push({ id: 'dl' + Date.now().toString(36), enabled: true, deviceKey: free ? free.key : '', modeId: free && free.outputModes[0] ? (free.outputModes.find((m) => m.id === 'Hp50') || free.outputModes[0]).id : '', keying: free && free.externalKeying ? 'external' : 'none', output: '1', alpha: 'premultiplied', pixelFormat: 'auto', keyLevel: 255 });
        renderTab(true);
      } }, '+ DeckLink-Ausgabe'),
      h('button', { class: 'btn sm', onclick: () => { S.dlDraft = null; renderTab(true); } }, 'Verwerfen'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: async () => {
        try { await api('/api/decklink/config', { method: 'POST', body: JSON.stringify({ outputs: S.dlDraft }) }); S.dlDraft = null; toast('DeckLink-Konfiguration übernommen', 'ok'); renderTab(true); } catch (e) { toast(e.message, 'err'); }
      } }, 'Übernehmen & starten')));
    card.appendChild(h('p', { class: 'hint' }, 'Fill + Key: Füllsignal auf SDI 1, Key (Alpha) auf SDI 2 – z. B. in den Upstream-Keyer eines ATEM. Interner Keyer: die Karte legt die Grafik in Hardware über das Signal an ihrem SDI-Eingang (gleiches Format nötig). Live-Eingang (Software): ein beliebiger DeckLink-Eingang wird als Hintergrund eingelesen und die Grafik darübergelegt – funktioniert auch über zwei verschiedene Karten.'));
    return card;
  }

  /* ---------- Einstellungen ---------- */
  function viewSettings(ed) {
    const p = S.project;
    const lan = (S.info && S.info.lan) || [];
    const imp = h('input', { type: 'file', accept: '.zip,.json', style: { display: 'none' }, onchange: () => importProject(imp) });
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Projekt'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: renameProject }, 'Umbenennen'),
        h('a', { class: 'btn sm', href: '/api/export', download: '' }, 'Exportieren (ZIP mit Medien)'),
        h('a', { class: 'btn sm', href: '/api/export?media=0', download: '' }, 'Exportieren (nur Daten)'),
        h('button', { class: 'btn sm', onclick: () => imp.click() }, 'Importieren …'), imp),
      h('p', { class: 'hint' }, 'Export enthält Grafiken, Theme, Variablen, Umfragen und alle verwendeten Medien und Schriften. Import legt immer ein neues Projekt an.')));
    const take = h('select', { class: 'inp', style: { width: 'auto' }, onchange: () => run('settings.update', { settings: { takeMode: take.value } }) },
      h('option', { value: 'add' }, 'Vorschau zusätzlich auf Sendung nehmen'), h('option', { value: 'replace' }, 'Sendung durch Vorschau ersetzen (Cut)'));
    take.value = p.settings.takeMode || 'add';
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Bedienung'), h('div', { class: 'field' }, h('label', null, 'Verhalten von TAKE'), take),
      h('p', { class: 'hint' }, 'Tastenkürzel: ', h('kbd', null, 'Strg/⌘+Enter'), ' Take · ', h('kbd', null, 'Strg/⌘+⌫'), ' alles ausblenden · ', h('kbd', null, 'Strg/⌘+D'), ' Grafik duplizieren · ', h('kbd', null, 'Strg/⌘+K'), ' Grafik suchen')));
    const pin = h('input', { type: 'password', class: 'inp', style: { width: '200px' }, placeholder: 'leer = kein Schutz' });
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Netzwerk & Zugriff'),
      ...lan.map((u) => h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'copy' }, u + '/control'), h('button', { class: 'btn xs', onclick: () => copyText(u + '/control') }, 'Kopieren'))),
      lan.length ? null : h('p', { class: 'hint' }, 'Keine Netzwerkadresse gefunden.'),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', null, 'Zugriffs-PIN für Steuerung & API:'), pin,
        h('button', { class: 'btn sm', onclick: async () => { await api('/api/access', { method: 'POST', body: JSON.stringify({ pin: pin.value }) }); toast(pin.value ? 'PIN gesetzt' : 'PIN entfernt', 'ok'); pin.value = ''; } }, 'Speichern')),
      h('p', { class: 'hint' }, 'Mit PIN müssen andere Rechner und Companion die PIN mitsenden (Header X-Cue-Pin oder ?pin=…). Der lokale Rechner und die Grafik-Ausgänge brauchen keine PIN.')));
    const ex = (path, desc) => h('tr', null, h('td', null, h('code', null, path)), h('td', null, desc));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'HTTP-API (für Companion, Stream Deck, Skripte)'),
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Alle Befehle per GET oder POST. ', h('code', null, ':g'), ' = Grafik-ID oder Grafikname. Für Bitfocus Companion gibt es das eigene CueGFX-Modul im Ordner companion-module.'),
      h('table', { class: 'tbl' },
        ex('/api/graphics', 'Liste aller Grafiken'), ex('/api/graphics/:g/show | hide | toggle | preview', 'Ein-/Ausblenden, Vorschau'),
        ex('/api/graphics/:g/update?feld=wert', 'Felder ändern, z. B. name=…&title=… · Grafik umbenennen: rename=… · Ausgänge: outputs=1,2'), ex('/api/graphics/:g/timer-start | timer-pause | timer-toggle | timer-reset', 'Timer steuern'),
        ex('/api/graphics/:g/timer-set?seconds=5:00', 'Timer setzen'), ex('/api/graphics/:g/timer-add?seconds=30', 'Zeit addieren'),
        ex('/api/graphics/:g/score?team=a&delta=1', 'Punkte'), ex('/api/graphics/:g/next | prev | goto?index=2', 'Songtext / Jetzt-Gleich-Danach'),
        ex('/api/take · /api/hide-all · /api/clear-preview', 'Globale Aktionen'), ex('/api/variables/:name?value=…', 'Variable setzen'),
        ex('/api/lists/:name/next | prev | select?index=…', 'Liste durchschalten'), ex('/api/projects · /api/projects/:id/switch', 'Projekte'),
        ex('POST /api/cmd {"cmd":"…","args":{…}}', 'Jeder interne Befehl'), ex('ws://…/ws?role=control', 'Live-Status per WebSocket'))));
    ed.appendChild(h('div', { class: 'card' }, h('h3', null, 'Über'), h('p', { class: 'hint', style: { margin: 0 } }, `CueGFX ${(S.info && S.info.version) || ''}${S.info && S.info.build ? ` · Build #${S.info.build.build} (${S.info.build.commit}, ${S.info.build.date})` : ' · lokal gebaut'} · Port ${(S.info && S.info.port) || ''}`)));
  }

  /* ---------- Projekte ---------- */
  async function renameProject() { const n = await UI.prompt('Projekt umbenennen', S.project.name); if (n) run('project.rename', { name: n }); }
  async function importProject(input) {
    const f = input.files[0]; if (!f) return;
    toast('Importiere …');
    try { const r = await api('/api/import', { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } }); toast(`Projekt importiert (${r.media} Mediendateien)`, 'ok'); reloadMedia(); } catch (e) { toast(e.message, 'err'); }
    input.value = '';
  }
  $('proj-btn').addEventListener('click', async (e) => {
    const anchor = e.currentTarget;
    let list = { projects: [] };
    try { list = await cmd('project.list'); } catch (_) {}
    const imp = h('input', { type: 'file', accept: '.zip,.json', style: { display: 'none' }, onchange: () => importProject(imp) });
    document.body.appendChild(imp);
    menu(anchor, [
      ...list.projects.map((p) => ({ label: `${p.id === S.project.id ? '● ' : ''}${p.name} (${p.graphics})`, cur: p.id === S.project.id, action: () => { if (p.id !== S.project.id) run('project.switch', { id: p.id }); } })),
      '-',
      { label: '+ Neues Projekt', action: async () => { const n = await UI.prompt('Neues Projekt', 'Neues Projekt'); if (n) run('project.create', { name: n }); } },
      { label: '⧉ Projekt duplizieren', action: async () => { const n = await UI.prompt('Projekt duplizieren', S.project.name + ' (Kopie)'); if (n) run('project.create', { name: n, duplicate: true }); } },
      { label: '✎ Umbenennen', action: renameProject },
      { label: '⇩ Exportieren', action: () => { location.href = '/api/export'; } },
      { label: '⇧ Importieren …', action: () => imp.click() },
      { label: '🗑 Anderes Projekt löschen …', action: async () => {
        const others = list.projects.filter((p) => p.id !== S.project.id);
        if (!others.length) { toast('Kein anderes Projekt vorhanden'); return; }
        const sel = h('select', { class: 'inp' }, others.map((p) => h('option', { value: p.id }, p.name)));
        const m = modal('Projekt löschen', h('div', null, sel, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'btn danger', onclick: () => { run('project.delete', { id: sel.value }); m.close(); } }, 'Endgültig löschen'))), { width: 420 });
      } }
    ]);
  });

  /* ---------- Monitore ---------- */
  function buildPgmSelect(keep) {
    const sel = $('pgm-out');
    const cur = keep ? sel.value || S.pgmOut : S.pgmOut;
    const sig = outputs().map((o) => o.id + o.name).join('|');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      for (const o of outputs()) sel.appendChild(h('option', { value: o.id }, `${o.id} · ${o.name}`));
    }
    sel.value = outputs().find((o) => o.id === cur) ? cur : '1';
    const src = `/output/${sel.value}?audio=0`;
    if ($('if-pgm').getAttribute('src') !== src) $('if-pgm').setAttribute('src', src);
  }
  $('pgm-out').addEventListener('change', () => { S.pgmOut = $('pgm-out').value; localStorage.setItem('cue.pgm', S.pgmOut); buildPgmSelect(); });
  function openOutput(id) {
    if (S.info && window.CUE_DESKTOP) api('/api/open-window', { method: 'POST', body: JSON.stringify({ path: '/output/' + id }) }).catch(() => window.open('/output/' + id, '_blank'));
    else window.open('/output/' + id, 'cue-out-' + id, 'width=960,height=540');
  }
  $('btn-open-out').addEventListener('click', () => openOutput($('pgm-out').value));
  $('btn-copy-url').addEventListener('click', () => copyText(outUrl($('pgm-out').value)));
  const fitScreens = () => {
    for (const [scr, ifr] of [['scr-pvw', 'if-pvw'], ['scr-pgm', 'if-pgm']]) {
      const w = $(scr).clientWidth;
      $(ifr).style.transform = `scale(${w / 1920})`;
    }
  };
  new ResizeObserver(fitScreens).observe($('monitors'));
  fitScreens();

  /* ---------- Kopfleiste & Tastatur ---------- */
  $('btn-take').addEventListener('click', () => run('take'));
  $('btn-hide-all').addEventListener('click', () => run('hideAll'));
  $('btn-clear-pvw').addEventListener('click', () => run('preview.clear'));
  $('btn-add').addEventListener('click', addGraphicDialog);
  $('search').addEventListener('input', () => { S.search = $('search').value; renderList(); });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); run('take'); }
    else if (mod && e.key === 'Backspace') { e.preventDefault(); run('hideAll'); }
    else if (mod && (e.key === 'd' || e.key === 'D') && S.sel) { e.preventDefault(); cmd('graphic.duplicate', { id: S.sel }).then((r) => select(r.id)).catch(() => {}); }
    else if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (S.tab !== 'graphics') setTab('graphics'); $('search').focus(); $('search').select(); }
  });

  fetch('/api/info').then((r) => r.json()).then((i) => { window.CUE_DESKTOP = i.desktop; S.info = Object.assign({}, S.info, i); }).catch(() => {});
  reloadMedia();
})();
