'use strict';
/* Feedbacks – färben Tasten nach Live-/Vorschau-Status, Timerstand usw. */
const { combineRgb } = require('@companion-module/base');
const { TIMER_TYPES, timerMs } = require('./variables');

const RED = combineRgb(229, 36, 59), GREEN = combineRgb(31, 184, 90), AMBER = combineRgb(245, 165, 36), WHITE = combineRgb(255, 255, 255), BLACK = combineRgb(0, 0, 0);

function buildFeedbacks(self) {
  const gch = (types) => {
    const list = self.graphics().filter((g) => !types || types.includes(g.type)).map((g) => ({ id: g.id, label: g.name }));
    return list.length ? list : [{ id: '', label: '— keine —' }];
  };
  const gopt = (types) => { const c = gch(types); return { type: 'dropdown', id: 'graphic', label: 'Grafik', choices: c, default: c[0].id, allowCustom: true }; };
  const find = (fb) => self.findGraphic(fb.options.graphic);
  const p = self.project;
  const polls = p ? p.polls.map((x) => ({ id: x.id, label: x.question })) : [];
  const lists = p ? Object.keys(p.variables.lists).map((n) => ({ id: n, label: n })) : [];

  return {
    graphic_live: {
      type: 'boolean', name: 'Grafik ist auf Sendung', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [gopt()], callback: (fb) => { const g = find(fb); return !!(g && g.live); }
    },
    graphic_preview: {
      type: 'boolean', name: 'Grafik ist in der Vorschau', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [gopt()], callback: (fb) => { const g = find(fb); return !!(g && g.preview); }
    },
    any_preview: {
      type: 'boolean', name: 'Vorschau enthält Grafiken (Take möglich)', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [], callback: () => !!(self.project && self.project.graphics.some((g) => g.preview))
    },
    timer_running: {
      type: 'boolean', name: 'Timer läuft', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [gopt(TIMER_TYPES)], callback: (fb) => { const g = find(fb); return !!(g && g.data.timer && g.data.timer.running); }
    },
    timer_below: {
      type: 'boolean', name: 'Timer unter Schwelle', description: 'Countdown hat die angegebene Restzeit erreicht oder ist abgelaufen',
      defaultStyle: { bgcolor: AMBER, color: BLACK },
      options: [gopt(TIMER_TYPES), { type: 'number', id: 'seconds', label: 'Schwelle (Sekunden)', default: 60, min: -86400, max: 86400 }],
      callback: (fb) => {
        const g = find(fb);
        if (!g || !g.data.timer || g.data.timer.mode === 'up') return false;
        return timerMs(g.data.timer, self.now()) / 1000 <= Number(fb.options.seconds);
      }
    },
    score_leading: {
      type: 'boolean', name: 'Team führt', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [gopt(['score']), { type: 'dropdown', id: 'team', label: 'Team', default: 'a', choices: [{ id: 'a', label: 'Team A' }, { id: 'b', label: 'Team B' }] }],
      callback: (fb) => {
        const g = find(fb); if (!g) return false;
        const a = Number(g.data.scoreA) || 0, b = Number(g.data.scoreB) || 0;
        return fb.options.team === 'a' ? a > b : b > a;
      }
    },
    poll_open: {
      type: 'boolean', name: 'Umfrage ist geöffnet', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'dropdown', id: 'poll', label: 'Umfrage', choices: polls.length ? polls : [{ id: '', label: '— keine —' }], default: polls[0] ? polls[0].id : '' }],
      callback: (fb) => { const x = self.project && self.project.polls.find((q) => q.id === fb.options.poll); return !!(x && x.open); }
    },
    list_index: {
      type: 'boolean', name: 'Liste steht auf Position', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'dropdown', id: 'name', label: 'Liste', choices: lists.length ? lists : [{ id: '', label: '— keine —' }], default: lists[0] ? lists[0].id : '', allowCustom: true },
        { type: 'number', id: 'index', label: 'Position (1 = erste)', default: 1, min: 1, max: 1000 }],
      callback: (fb) => { const l = self.project && self.project.variables.lists[fb.options.name]; return !!(l && (l.index || 0) === Number(fb.options.index) - 1); }
    },
    has_new_questions: {
      type: 'boolean', name: 'Q&A: Fragen warten auf Freigabe', defaultStyle: { bgcolor: AMBER, color: BLACK },
      options: [], callback: () => !!(self.project && self.project.questions.some((q) => q.status === 'pending'))
    },
    qa_pending_flagged: {
      type: 'boolean', name: 'Q&A: Wartende Frage enthält Sperrwort',
      defaultStyle: { bgcolor: RED, color: WHITE },
      options: [], callback: () => { const q = require('./variables').oldestPending(self.project); return !!(q && (q.flagged || []).length); }
    },
    qa_has_active: {
      type: 'boolean', name: 'Q&A: Eine Frage ist aktiv', defaultStyle: { bgcolor: AMBER, color: BLACK },
      options: [], callback: () => !!(self.project && self.project.questions.some((q) => q.active))
    },
    qa_setting: {
      type: 'boolean', name: 'Q&A: Einstellung ist an', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'dropdown', id: 'key', label: 'Einstellung', default: 'open', choices: [{ id: 'open', label: 'Fragen erlaubt' }, { id: 'moderation', label: 'Fragen vor Freigabe prüfen' }, { id: 'allowLikes', label: 'Likes erlaubt' }, { id: 'showQuestions', label: 'Publikum sieht Fragenliste' }] }],
      callback: (fb) => !!(self.project && self.project.qaSettings && self.project.qaSettings[fb.options.key])
    }
  };
}

module.exports = { buildFeedbacks, RED, GREEN, AMBER, WHITE, BLACK };
