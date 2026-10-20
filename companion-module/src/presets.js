'use strict';
/* Fertige Tasten (Presets) – werden für jede Grafik des aktiven Projekts automatisch erzeugt */
const { combineRgb } = require('@companion-module/base');
const { graphicKeys, slug, TIMER_TYPES } = require('./variables');
const { RED, GREEN, WHITE, BLACK, AMBER } = require('./feedbacks');

const DARK = combineRgb(30, 34, 42), DARK_RED = combineRgb(80, 20, 30), DARK_GREEN = combineRgb(18, 60, 38);

function btn(category, name, text, down, feedbacks, opts) {
  return {
    type: 'button', category, name,
    style: Object.assign({ text, size: 'auto', color: WHITE, bgcolor: DARK }, opts && opts.style),
    steps: [{ down: down.map(([actionId, options]) => ({ actionId, options: options || {} })), up: [] }],
    feedbacks: (feedbacks || []).map(([feedbackId, options, style]) => ({ feedbackId, options: options || {}, style }))
  };
}

function buildPresets(self) {
  const P = {};
  const L = self.label || 'cuegfx';
  const v = (name) => `$(${L}:${name})`;

  P.take = btn('Global', 'TAKE', 'TAKE', [['take']], [['any_preview', {}, { bgcolor: RED, color: WHITE }]], { style: { size: 18, bgcolor: DARK_RED } });
  P.hide_all = btn('Global', 'Alles ausblenden', 'ALLES\\nAUS', [['hide_all', { output: '' }]], [], { style: { bgcolor: DARK_RED } });
  P.clear_pvw = btn('Global', 'Vorschau leeren', 'PVW\\nLEEREN', [['clear_preview']], [], { style: { bgcolor: DARK_GREEN } });
  P.status = btn('Global', 'Status', `LIVE ${v('live_count')}\\nPVW ${v('preview_count')}`, [], [], { style: { size: 14 } });
  P.qa_active_next = btn('Q&A', 'Nächste Frage aktiv', `NÄCHSTE\\nFRAGE\\n${v('questions_live')} offen`, [['qa_active_next', { sort: 'likes', resolve: true }]], [['qa_has_active', {}, { bgcolor: DARK_GREEN, color: WHITE }]], { style: { size: 14 } });
  P.qa_resolve = btn('Q&A', 'Aktive Frage gelöst', '✓ GELÖST', [['qa_resolve_active']], [['qa_has_active', {}, { bgcolor: AMBER, color: BLACK }]]);
  P.qa_pending = btn('Q&A', 'Wartende Fragen freigeben', `PRÜFEN\\n${v('questions_new')}`, [['qa_approve_all']], [['has_new_questions', {}, { bgcolor: AMBER, color: BLACK }]], { style: { size: 14 } });
  P.qa_mod_text = btn('Q&A', 'Wartende Frage (Text)', `${v('qa_pending_text')}`, [], [['qa_pending_flagged', {}, { bgcolor: RED, color: WHITE }]], { style: { size: 7 } });
  P.qa_mod_ok = btn('Q&A', 'Wartende Frage freigeben', `✓ FREI\\n${v('questions_new')} wartend`, [['qa_moderate_next', { mode: 'approve' }]], [['has_new_questions', {}, { bgcolor: GREEN, color: WHITE }]], { style: { size: 14 } });
  P.qa_mod_no = btn('Q&A', 'Wartende Frage ablehnen', '✕ ABLEHNEN', [['qa_moderate_next', { mode: 'reject' }]], [['qa_pending_flagged', {}, { bgcolor: RED, color: WHITE }]], { style: { size: 14, bgcolor: DARK_RED } });
  P.qa_show_active = btn('Q&A', 'Aktive Frage einblenden', 'FRAGE\\nZEIGEN', [['qa_show_active', { preview: false }]], [['qa_has_active', {}, { bgcolor: DARK_GREEN, color: WHITE }]]);
  P.qa_open = btn('Q&A', 'Fragen erlauben an/aus', 'FRAGEN\\nOFFEN', [['qa_settings', { key: 'open', mode: 'toggle' }]], [['qa_setting', { key: 'open' }, { bgcolor: GREEN, color: WHITE }]]);
  P.qa_active_text = btn('Q&A', 'Aktive Frage (Anzeige)', `${v('qa_active_text')}`, [], [['qa_has_active', {}, { bgcolor: AMBER, color: BLACK }]], { style: { size: 7 } });

  const p = self.project;
  if (!p) return P;
  const keys = graphicKeys(p.graphics);
  for (const g of p.graphics) {
    const k = keys.get(g.id);
    const name = g.name.length > 24 ? g.name.slice(0, 23) + '…' : g.name;
    const opt = { graphic: g.id };
    P[`live_${g.id}`] = btn('Grafiken: Live', `${g.name} – Live umschalten`, name, [['graphic_toggle', opt]],
      [['graphic_live', opt, { bgcolor: RED, color: WHITE }], ['graphic_preview', opt, { bgcolor: DARK_GREEN, color: WHITE }]]);
    P[`pvw_${g.id}`] = btn('Grafiken: Vorschau', `${g.name} – Vorschau umschalten`, `PVW\\n${name}`, [['graphic_preview', Object.assign({ mode: 'toggle' }, opt)]],
      [['graphic_preview', opt, { bgcolor: GREEN, color: WHITE }], ['graphic_live', opt, { bgcolor: DARK_RED, color: WHITE }]]);

    if (TIMER_TYPES.includes(g.type) && (g.type !== 'score' || g.data.showClock)) {
      P[`timer_${g.id}`] = btn('Timer', `${g.name} – Start/Pause`, `${name}\\n${v(`g_${k}_timer`)}`, [['timer_control', Object.assign({ op: 'toggle' }, opt)]],
        [['timer_running', opt, { bgcolor: GREEN, color: WHITE }], ['timer_below', Object.assign({ seconds: 0 }, opt), { bgcolor: RED, color: WHITE }]], { style: { size: 14 } });
      P[`treset_${g.id}`] = btn('Timer', `${g.name} – Zurücksetzen`, `↺\\n${name}`, [['timer_control', Object.assign({ op: 'reset' }, opt)]]);
      P[`tplus_${g.id}`] = btn('Timer', `${g.name} – +1 Minute`, '+1:00', [['timer_add', Object.assign({ seconds: 60 }, opt)]]);
      P[`tminus_${g.id}`] = btn('Timer', `${g.name} – −1 Minute`, '−1:00', [['timer_add', Object.assign({ seconds: -60 }, opt)]]);
    }
    if (g.type === 'score') {
      for (const team of ['a', 'b']) {
        P[`score_${team}_${g.id}`] = btn('Spielstand', `${g.name} – Team ${team.toUpperCase()} +1`, `${v(`g_${k}_team_${team}`)}\\n${v(`g_${k}_score_${team}`)}`,
          [['score_add', Object.assign({ team, delta: 1 }, opt)]], [['score_leading', Object.assign({ team }, opt), { bgcolor: GREEN, color: WHITE }]], { style: { size: 18 } });
        P[`scorem_${team}_${g.id}`] = btn('Spielstand', `${g.name} – Team ${team.toUpperCase()} −1`, `${v(`g_${k}_team_${team}`)}\\n−1`, [['score_add', Object.assign({ team, delta: -1 }, opt)]]);
      }
    }
    if (g.type === 'lyrics' || g.type === 'nnt') {
      P[`next_${g.id}`] = btn('Songtexte & Programm', `${g.name} – Weiter`, `▶ ${v(`g_${k}_index`)}/${v(`g_${k}_count`)}\\n${v(`g_${k}_next`)}`, [['step', Object.assign({ dir: '1' }, opt)]], [], { style: { size: 7 } });
      P[`prev_${g.id}`] = btn('Songtexte & Programm', `${g.name} – Zurück`, `◀\\n${name}`, [['step', Object.assign({ dir: '-1' }, opt)]]);
    }
  }
  for (const name of Object.keys(p.variables.lists)) {
    const s = slug(name);
    P[`listn_${s}`] = btn('Listen', `${name} – weiter`, `${name} ▶\\n${v(`list_${s}`)}`, [['list_step', { name, dir: '1' }]], [], { style: { size: 14 } });
    P[`listp_${s}`] = btn('Listen', `${name} – zurück`, `◀ ${name}\\n${v(`list_${s}_pos`)}`, [['list_step', { name, dir: '-1' }]]);
  }
  for (const poll of p.polls) {
    P[`poll_${poll.id}`] = btn('Umfragen', `${poll.question} – öffnen/schließen`, `UMFRAGE\\n${poll.question.slice(0, 30)}`, [['poll_open', { poll: poll.id, mode: 'toggle' }]],
      [['poll_open', { poll: poll.id }, { bgcolor: GREEN, color: WHITE }]], { style: { size: 7 } });
  }
  return P;
}

module.exports = { buildPresets };
