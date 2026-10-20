'use strict';
/* Aktionen */
const { TIMER_TYPES, oldestPending } = require('./variables');

function choices(self) {
  const g = self.graphics().map((x) => ({ id: x.id, label: `${x.name} (${x.type})` }));
  return g.length ? g : [{ id: '', label: '— keine Grafiken —' }];
}
function typed(self, types) {
  const g = self.graphics().filter((x) => types.includes(x.type)).map((x) => ({ id: x.id, label: x.name }));
  return g.length ? g : [{ id: '', label: '— keine passenden Grafiken —' }];
}

function graphicOpt(self, types, label) {
  const ch = types ? typed(self, types) : choices(self);
  return {
    type: 'dropdown', id: 'graphic', label: label || 'Grafik', choices: ch, default: ch[0].id, allowCustom: true,
    tooltip: 'Auswahl oder eigener Wert: Grafik-ID oder exakter Grafikname (Variablen erlaubt)'
  };
}

async function parse(self, context, str) {
  const s = String(str === undefined || str === null ? '' : str);
  if (!s.includes('$(')) return s;
  if (context && typeof context.parseVariablesInString === 'function') return context.parseVariablesInString(s);
  return self.parseVariablesInString(s);
}

async function resolveId(self, context, opt) {
  const ref = await parse(self, context, opt);
  const g = self.findGraphic(ref);
  if (!g) { self.log('warn', `Grafik nicht gefunden: ${ref}`); return null; }
  return g.id;
}

function buildActions(self) {
  const p = self.project;
  const outputs = p ? p.settings.outputs.map((o) => ({ id: o.id, label: `${o.id} · ${o.name}` })) : [];
  const lists = p ? Object.keys(p.variables.lists).map((n) => ({ id: n, label: n })) : [];
  const vars = p ? Object.keys(p.variables.text).map((n) => ({ id: n, label: n })) : [];
  const polls = p ? p.polls.map((x) => ({ id: x.id, label: x.question })) : [];
  const forGraphic = (cmd, extra) => async (ev, ctx) => {
    const id = await resolveId(self, ctx, ev.options.graphic);
    if (id) await self.run(cmd, Object.assign({ id }, extra ? await extra(ev, ctx) : {}));
  };

  return {
    graphic_show: { name: 'Grafik einblenden (Live)', options: [graphicOpt(self)], callback: forGraphic('graphic.show') },
    graphic_hide: { name: 'Grafik ausblenden', options: [graphicOpt(self)], callback: forGraphic('graphic.hide') },
    graphic_toggle: { name: 'Grafik Live umschalten', options: [graphicOpt(self)], callback: forGraphic('graphic.toggle') },
    graphic_preview: {
      name: 'Grafik in Vorschau (PVW)',
      options: [graphicOpt(self), { type: 'dropdown', id: 'mode', label: 'Modus', default: 'toggle', choices: [{ id: 'toggle', label: 'Umschalten' }, { id: 'on', label: 'Ein' }, { id: 'off', label: 'Aus' }] }],
      callback: forGraphic('graphic.preview', (ev) => (ev.options.mode === 'toggle' ? {} : { on: ev.options.mode === 'on' }))
    },
    graphic_preview_exclusive: {
      name: 'Nur diese Grafik in Vorschau',
      options: [graphicOpt(self)],
      callback: async (ev, ctx) => {
        const id = await resolveId(self, ctx, ev.options.graphic);
        if (!id) return;
        await self.run('preview.clear');
        await self.run('graphic.preview', { id, on: true });
      }
    },
    take: { name: 'TAKE (Vorschau auf Sendung)', options: [], callback: () => self.run('take') },
    hide_all: {
      name: 'Alles ausblenden',
      options: [{ type: 'dropdown', id: 'output', label: 'Ausgang', default: '', choices: [{ id: '', label: 'Alle Ausgänge' }, ...outputs] }],
      callback: (ev) => self.run('hideAll', ev.options.output ? { output: ev.options.output } : {})
    },
    clear_preview: { name: 'Vorschau leeren', options: [], callback: () => self.run('preview.clear') },
    graphic_update: {
      name: 'Grafik-Feld ändern',
      description: 'Setzt ein Feld der Grafik, z. B. name, title, body, heading, message, label, url …',
      options: [graphicOpt(self),
        { type: 'textinput', id: 'field', label: 'Feld (z. B. name, title, body, label)', default: 'name' },
        { type: 'textinput', id: 'value', label: 'Wert', default: '', useVariables: true }],
      callback: async (ev, ctx) => {
        const id = await resolveId(self, ctx, ev.options.graphic);
        if (!id) return;
        const field = String(ev.options.field || '').trim();
        if (!field) return;
        await self.run('graphic.update', { id, data: { [field]: await parse(self, ctx, ev.options.value) } });
      }
    },

    /* Timer */
    timer_control: {
      name: 'Timer steuern',
      options: [graphicOpt(self, TIMER_TYPES, 'Timer-Grafik'),
        { type: 'dropdown', id: 'op', label: 'Aktion', default: 'toggle', choices: [{ id: 'toggle', label: 'Start/Pause' }, { id: 'start', label: 'Start' }, { id: 'pause', label: 'Pause' }, { id: 'reset', label: 'Zurücksetzen' }] }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('timer.' + ev.options.op, { id }); }
    },
    timer_set: {
      name: 'Timer setzen',
      options: [graphicOpt(self, TIMER_TYPES, 'Timer-Grafik'),
        { type: 'textinput', id: 'time', label: 'Zeit (Sekunden oder mm:ss oder hh:mm:ss)', default: '5:00', useVariables: true },
        { type: 'checkbox', id: 'start', label: 'Direkt starten', default: false }],
      callback: async (ev, ctx) => {
        const id = await resolveId(self, ctx, ev.options.graphic); if (!id) return;
        const g = self.findGraphic(id);
        await self.run('timer.set', { id, seconds: await parse(self, ctx, ev.options.time), elapsed: g && g.data.timer && g.data.timer.mode === 'up' });
        if (ev.options.start) await self.run('timer.start', { id });
      }
    },
    timer_add: {
      name: 'Timer: Zeit addieren/abziehen',
      options: [graphicOpt(self, TIMER_TYPES, 'Timer-Grafik'), { type: 'number', id: 'seconds', label: 'Sekunden (negativ = abziehen)', default: 60, min: -86400, max: 86400 }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('timer.add', { id, seconds: ev.options.seconds }); }
    },
    timer_mode: {
      name: 'Timer: Modus',
      options: [graphicOpt(self, TIMER_TYPES, 'Timer-Grafik'), { type: 'dropdown', id: 'mode', label: 'Modus', default: 'down', choices: [{ id: 'down', label: 'Countdown' }, { id: 'up', label: 'Stoppuhr' }] }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('timer.mode', { id, mode: ev.options.mode }); }
    },

    /* Spielstand */
    score_add: {
      name: 'Spielstand: Punkte',
      options: [graphicOpt(self, ['score'], 'Spielstand'),
        { type: 'dropdown', id: 'team', label: 'Team', default: 'a', choices: [{ id: 'a', label: 'Team A (Heim)' }, { id: 'b', label: 'Team B (Gast)' }] },
        { type: 'number', id: 'delta', label: 'Punkte (+/-)', default: 1, min: -100, max: 100 }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('score.add', { id, team: ev.options.team, delta: ev.options.delta }); }
    },
    score_set: {
      name: 'Spielstand: setzen',
      options: [graphicOpt(self, ['score'], 'Spielstand'),
        { type: 'textinput', id: 'a', label: 'Punkte A', default: '0', useVariables: true }, { type: 'textinput', id: 'b', label: 'Punkte B', default: '0', useVariables: true }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('score.set', { id, a: await parse(self, ctx, ev.options.a), b: await parse(self, ctx, ev.options.b) }); }
    },
    score_reset: { name: 'Spielstand: auf 0', options: [graphicOpt(self, ['score'], 'Spielstand')], callback: forGraphic('score.reset') },
    score_swap: { name: 'Spielstand: Seiten tauschen', options: [graphicOpt(self, ['score'], 'Spielstand')], callback: forGraphic('score.swap') },

    /* Songtexte / Jetzt-Gleich-Danach */
    step: {
      name: 'Songtext / Programm: weiter/zurück',
      options: [graphicOpt(self, ['lyrics', 'nnt'], 'Grafik'),
        { type: 'dropdown', id: 'dir', label: 'Richtung', default: '1', choices: [{ id: '1', label: 'Weiter' }, { id: '-1', label: 'Zurück' }] }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('step', { id, delta: Number(ev.options.dir) }); }
    },
    step_goto: {
      name: 'Songtext / Programm: zu Position',
      options: [graphicOpt(self, ['lyrics', 'nnt'], 'Grafik'), { type: 'textinput', id: 'index', label: 'Position (1 = erste)', default: '1', useVariables: true }],
      callback: async (ev, ctx) => { const id = await resolveId(self, ctx, ev.options.graphic); if (id) await self.run('step.goto', { id, index: Number(await parse(self, ctx, ev.options.index)) - 1 }); }
    },

    /* Variablen & Listen */
    var_set: {
      name: 'Variable setzen',
      options: [{ type: 'dropdown', id: 'name', label: 'Variable', choices: vars.length ? vars : [{ id: 'sendung', label: 'sendung' }], default: vars[0] ? vars[0].id : 'sendung', allowCustom: true },
        { type: 'textinput', id: 'value', label: 'Wert', default: '', useVariables: true }],
      callback: async (ev, ctx) => self.run('var.set', { name: await parse(self, ctx, ev.options.name), value: await parse(self, ctx, ev.options.value) })
    },
    list_step: {
      name: 'Liste: weiter/zurück',
      options: [{ type: 'dropdown', id: 'name', label: 'Liste', choices: lists.length ? lists : [{ id: '', label: '— keine Listen —' }], default: lists[0] ? lists[0].id : '', allowCustom: true },
        { type: 'dropdown', id: 'dir', label: 'Richtung', default: '1', choices: [{ id: '1', label: 'Weiter' }, { id: '-1', label: 'Zurück' }] }],
      callback: async (ev, ctx) => self.run('list.select', { name: await parse(self, ctx, ev.options.name), delta: Number(ev.options.dir) })
    },
    list_select: {
      name: 'Liste: Eintrag wählen',
      options: [{ type: 'dropdown', id: 'name', label: 'Liste', choices: lists.length ? lists : [{ id: '', label: '— keine Listen —' }], default: lists[0] ? lists[0].id : '', allowCustom: true },
        { type: 'textinput', id: 'index', label: 'Position (1 = erste)', default: '1', useVariables: true }],
      callback: async (ev, ctx) => self.run('list.select', { name: await parse(self, ctx, ev.options.name), index: Number(await parse(self, ctx, ev.options.index)) - 1 })
    },

    /* Publikum */
    qa_active_next: {
      name: 'Q&A: Nächste Frage aktiv',
      description: 'Markiert die aktive Frage als gelöst und hebt die nächste offene Frage hervor',
      options: [{ type: 'dropdown', id: 'sort', label: 'Reihenfolge', default: 'likes', choices: [{ id: 'likes', label: 'Beliebteste zuerst' }, { id: 'oldest', label: 'Älteste zuerst' }, { id: 'newest', label: 'Neueste zuerst' }] },
        { type: 'checkbox', id: 'resolve', label: 'Bisher aktive Frage als gelöst markieren', default: true }],
      callback: (ev) => self.run('qa.activeNext', { sort: ev.options.sort, resolvePrevious: ev.options.resolve })
    },
    qa_resolve_active: { name: 'Q&A: Aktive Frage gelöst', options: [], callback: () => self.run('qa.resolveActive') },
    qa_approve_all: { name: 'Q&A: Alle wartenden Fragen freigeben', description: 'Fragen mit Sperrwort-Treffer bleiben stehen', options: [], callback: () => self.run('qa.approveAll') },
    qa_moderate_next: {
      name: 'Q&A: Älteste wartende Frage freigeben/ablehnen',
      description: 'Moderation per Taste – der Text steht in $(cuegfx:qa_pending_text)',
      options: [{ type: 'dropdown', id: 'mode', label: 'Aktion', default: 'approve', choices: [{ id: 'approve', label: 'Freigeben' }, { id: 'reject', label: 'Ablehnen' }] }],
      callback: async (ev) => {
        const q = oldestPending(self.project);
        if (!q) { self.log('info', 'Keine Frage wartet auf Prüfung'); return; }
        await self.run(ev.options.mode === 'reject' ? 'qa.reject' : 'qa.approve', { id: q.id });
      }
    },
    qa_show_active: {
      name: 'Q&A: Aktive Frage einblenden',
      description: 'Zeigt die hervorgehobene Frage in der Grafik „Publikumsfrage“',
      options: [{ type: 'checkbox', id: 'preview', label: 'Nur in Vorschau', default: false }],
      callback: async (ev) => {
        const q = self.project && self.project.questions.find((x) => x.active);
        if (!q) { self.log('info', 'Keine aktive Frage'); return; }
        await self.run('qa.show', { id: q.id, live: !ev.options.preview });
      }
    },
    qa_settings: {
      name: 'Q&A: Einstellung umschalten',
      options: [{ type: 'dropdown', id: 'key', label: 'Einstellung', default: 'open', choices: [{ id: 'open', label: 'Fragen erlaubt' }, { id: 'moderation', label: 'Fragen vor Freigabe prüfen' }, { id: 'allowLikes', label: 'Likes erlaubt' }, { id: 'showQuestions', label: 'Publikum sieht Fragenliste' }] },
        { type: 'dropdown', id: 'mode', label: 'Modus', default: 'toggle', choices: [{ id: 'toggle', label: 'Umschalten' }, { id: 'on', label: 'Ein' }, { id: 'off', label: 'Aus' }] }],
      callback: async (ev) => {
        const qs = self.project && self.project.qaSettings; if (!qs) return;
        const val = ev.options.mode === 'toggle' ? !qs[ev.options.key] : ev.options.mode === 'on';
        await self.run('qa.settings', { [ev.options.key]: val });
      }
    },
    qa_next: {
      name: 'Q&A: Nächste Frage einzeln einblenden',
      description: 'Blendet die nächste offene Frage in der Grafik „Publikumsfrage“ ein',
      options: [{ type: 'dropdown', id: 'source', label: 'Aus', default: 'likes', choices: [{ id: 'likes', label: 'Beliebteste offene Frage' }, { id: 'oldest', label: 'Älteste offene Frage' }, { id: 'newest', label: 'Neueste offene Frage' }] },
        { type: 'checkbox', id: 'preview', label: 'Nur in Vorschau', default: false }],
      callback: async (ev) => {
        const qs = (self.project ? self.project.questions : []).filter((q) => q.status === 'live' && !q.resolved && !q.active);
        const sorted = qs.sort(ev.options.source === 'newest' ? (a, b) => b.ts - a.ts : ev.options.source === 'oldest' ? (a, b) => a.ts - b.ts : (a, b) => (b.likes - a.likes) || (a.ts - b.ts));
        const cur = self.project && self.project.questions.find((q) => q.active);
        if (cur) await self.run('qa.resolve', { id: cur.id, on: true });
        if (!sorted[0]) { self.log('info', 'Keine offene Frage vorhanden'); return; }
        await self.run('qa.show', { id: sorted[0].id, live: !ev.options.preview });
      }
    },
    poll_open: {
      name: 'Umfrage öffnen/schließen',
      options: [{ type: 'dropdown', id: 'poll', label: 'Umfrage', choices: polls.length ? polls : [{ id: '', label: '— keine Umfragen —' }], default: polls[0] ? polls[0].id : '' },
        { type: 'dropdown', id: 'mode', label: 'Modus', default: 'toggle', choices: [{ id: 'toggle', label: 'Umschalten' }, { id: 'open', label: 'Öffnen' }, { id: 'close', label: 'Schließen' }] }],
      callback: async (ev) => {
        const poll = self.project && self.project.polls.find((x) => x.id === ev.options.poll);
        if (!poll) return;
        const open = ev.options.mode === 'toggle' ? !poll.open : ev.options.mode === 'open';
        await self.run('poll.update', { id: poll.id, open });
      }
    },
    poll_reset: {
      name: 'Umfrage zurücksetzen',
      options: [{ type: 'dropdown', id: 'poll', label: 'Umfrage', choices: polls.length ? polls : [{ id: '', label: '— keine Umfragen —' }], default: polls[0] ? polls[0].id : '' }],
      callback: (ev) => self.run('poll.reset', { id: ev.options.poll })
    },

    /* Sonstiges */
    theme_preset: {
      name: 'Design-Vorlage anwenden',
      options: [{ type: 'dropdown', id: 'preset', label: 'Vorlage', default: 'studio', allowCustom: true,
        choices: [['studio', 'Studio'], ['neon', 'Neon'], ['clean', 'Clean Weiß'], ['sport', 'Sport'], ['worship', 'Gottesdienst'], ['corporate', 'Corporate']].map(([id, label]) => ({ id, label })) }],
      callback: (ev) => self.run('theme.preset', { preset: ev.options.preset })
    },
    project_switch: {
      name: 'Projekt wechseln',
      options: [{ type: 'textinput', id: 'project', label: 'Projekt-ID oder -Name', default: '', useVariables: true }],
      callback: async (ev, ctx) => {
        const ref = (await parse(self, ctx, ev.options.project)).trim().toLowerCase();
        const list = await self.run('project.list');
        const p = list && list.projects.find((x) => x.id.toLowerCase() === ref || x.name.toLowerCase() === ref);
        if (p) await self.run('project.switch', { id: p.id }); else self.log('warn', 'Projekt nicht gefunden: ' + ref);
      }
    },
    raw_command: {
      name: 'Experte: beliebiger Befehl',
      options: [{ type: 'textinput', id: 'cmd', label: 'Befehl (z. B. graphic.show)', default: 'graphic.show' },
        { type: 'textinput', id: 'args', label: 'Argumente als JSON', default: '{"id":""}', useVariables: true }],
      callback: async (ev, ctx) => {
        let args = {};
        try { args = JSON.parse(await parse(self, ctx, ev.options.args) || '{}'); } catch (e) { self.log('error', 'Ungültiges JSON: ' + e.message); return; }
        await self.run(ev.options.cmd, args);
      }
    }
  };
}

module.exports = { buildActions };
