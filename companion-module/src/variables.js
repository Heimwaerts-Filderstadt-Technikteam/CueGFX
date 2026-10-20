'use strict';
const oldestPending = (p) => (p && p.questions ? p.questions : []).filter((q) => q.status === 'pending').sort((a, b) => a.ts - b.ts)[0] || null;
/* Variablen: Projektstatus, je Grafik (Live, Vorschau, Timer, Spielstand, Folie) und alle CueGFX-Variablen */

function slug(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';
}

/* Eindeutige Kurz-Namen je Grafik (bei gleichen Namen mit Zähler) */
function graphicKeys(graphics) {
  const used = new Map();
  const out = new Map();
  for (const g of graphics) {
    let k = slug(g.name);
    const n = used.get(k) || 0;
    used.set(k, n + 1);
    if (n) k = `${k}_${n + 1}`;
    out.set(g.id, k);
  }
  return out;
}

const TIMER_TYPES = ['timer', 'bigtimer', 'speakertimer', 'score'];

function timerMs(t, now) {
  if (!t) return 0;
  const el = (t.elapsedBefore || 0) + (t.running ? Math.max(0, now - (t.startedAt || now)) : 0);
  return t.mode === 'up' ? el : (t.duration || 0) * 1000 - el;
}
function fmt(ms, mode) {
  const neg = ms < 0;
  const total = mode === 'up' ? Math.floor(Math.max(0, ms) / 1000) : neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000 - 1e-6);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const p = (x) => String(x).padStart(2, '0');
  return (neg && total > 0 ? '-' : '') + (h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`);
}

function stepInfo(g) {
  if (g.type === 'lyrics') {
    const slides = String(g.data.text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const i = Number(g.data.index) || 0;
    return { count: slides.length, index: i, current: slides[i] || '', next: slides[i + 1] || '' };
  }
  if (g.type === 'nnt') {
    const items = g.data.items || [];
    const i = Number(g.data.index) || 0;
    return { count: items.length, index: i, current: items[i] ? items[i].title : '', next: items[i + 1] ? items[i + 1].title : '' };
  }
  return null;
}

function buildVariables(self) {
  const defs = [
    { variableId: 'connected', name: 'Verbunden (true/false)' },
    { variableId: 'project', name: 'Projektname' },
    { variableId: 'live_count', name: 'Anzahl Grafiken auf Sendung' },
    { variableId: 'live_names', name: 'Namen der Grafiken auf Sendung' },
    { variableId: 'preview_count', name: 'Anzahl Grafiken in der Vorschau' },
    { variableId: 'preview_names', name: 'Namen der Grafiken in der Vorschau' },
    { variableId: 'questions_new', name: 'Q&A: Fragen zur Prüfung' },
    { variableId: 'questions_live', name: 'Q&A: offene freigegebene Fragen' },
    { variableId: 'qa_active_text', name: 'Q&A: Text der aktiven Frage' },
    { variableId: 'qa_active_author', name: 'Q&A: Name bei der aktiven Frage' },
    { variableId: 'qa_active_likes', name: 'Q&A: Likes der aktiven Frage' },
    { variableId: 'qa_pending_text', name: 'Q&A: älteste wartende Frage (zur Moderation)' },
    { variableId: 'qa_pending_author', name: 'Q&A: Name bei der ältesten wartenden Frage' },
    { variableId: 'qa_pending_flagged', name: 'Q&A: älteste wartende Frage hat Sperrwort (true/false)' },
    { variableId: 'polls_open', name: 'Umfragen: Anzahl geöffnet' },
    { variableId: 'app_version', name: 'CueGFX-Version' },
    { variableId: 'time', name: 'Uhrzeit des CueGFX-Rechners' }
  ];
  const p = self.project;
  if (p) {
    const keys = graphicKeys(p.graphics);
    for (const g of p.graphics) {
      const k = keys.get(g.id);
      defs.push({ variableId: `g_${k}_live`, name: `${g.name}: live (true/false)` });
      defs.push({ variableId: `g_${k}_preview`, name: `${g.name}: in Vorschau (true/false)` });
      defs.push({ variableId: `g_${k}_state`, name: `${g.name}: Status (LIVE/PVW/–)` });
      if (TIMER_TYPES.includes(g.type)) {
        defs.push({ variableId: `g_${k}_timer`, name: `${g.name}: Timer-Anzeige` });
        defs.push({ variableId: `g_${k}_timer_s`, name: `${g.name}: Timer in Sekunden` });
        defs.push({ variableId: `g_${k}_timer_running`, name: `${g.name}: Timer läuft (true/false)` });
      }
      if (g.type === 'score') {
        defs.push({ variableId: `g_${k}_score_a`, name: `${g.name}: Punkte A` }, { variableId: `g_${k}_score_b`, name: `${g.name}: Punkte B` });
        defs.push({ variableId: `g_${k}_team_a`, name: `${g.name}: Team A` }, { variableId: `g_${k}_team_b`, name: `${g.name}: Team B` });
      }
      if (g.type === 'lyrics' || g.type === 'nnt') {
        defs.push({ variableId: `g_${k}_index`, name: `${g.name}: aktuelle Position` }, { variableId: `g_${k}_count`, name: `${g.name}: Anzahl` });
        defs.push({ variableId: `g_${k}_current`, name: `${g.name}: aktueller Text` }, { variableId: `g_${k}_next`, name: `${g.name}: nächster Text` });
      }
    }
    for (const name of Object.keys(p.variables.text)) defs.push({ variableId: `var_${slug(name)}`, name: `Variable {{${name}}}` });
    for (const name of Object.keys(p.variables.lists)) {
      defs.push({ variableId: `list_${slug(name)}`, name: `Liste {{${name}}}: aktueller Eintrag` });
      defs.push({ variableId: `list_${slug(name)}_pos`, name: `Liste {{${name}}}: Position` });
    }
  }
  return defs;
}

function computeVariables(self) {
  const p = self.project;
  const now = self.now();
  const v = {};
  v.connected = String(!!(self.ws && self.ws.readyState === 1));
  const d = new Date(now);
  v.time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  if (!p) return v;
  const live = p.graphics.filter((g) => g.live), pv = p.graphics.filter((g) => g.preview);
  v.project = p.name;
  v.live_count = String(live.length);
  v.live_names = live.map((g) => g.name).join(', ');
  v.preview_count = String(pv.length);
  v.preview_names = pv.map((g) => g.name).join(', ');
  v.questions_new = String(p.questions.filter((q) => q.status === 'pending').length);
  v.questions_live = String(p.questions.filter((q) => q.status === 'live' && !q.resolved).length);
  const act = p.questions.find((q) => q.active);
  v.qa_active_text = act ? act.text.replace(/\n/g, ' ') : '';
  v.qa_active_author = act ? act.author : '';
  v.qa_active_likes = act ? String(act.likes || 0) : '';
  const nextPending = oldestPending(p);
  v.qa_pending_text = nextPending ? nextPending.text.replace(/\n/g, ' ') : '';
  v.qa_pending_author = nextPending ? nextPending.author : '';
  v.qa_pending_flagged = nextPending && (nextPending.flagged || []).length ? 'true' : 'false';
  v.polls_open = String((p.polls || []).filter((x) => x.open).length);
  v.app_version = (self.info && self.info.version) || '';
  const keys = graphicKeys(p.graphics);
  for (const g of p.graphics) {
    const k = keys.get(g.id);
    v[`g_${k}_live`] = String(!!g.live);
    v[`g_${k}_preview`] = String(!!g.preview);
    v[`g_${k}_state`] = g.live ? 'LIVE' : g.preview ? 'PVW' : '–';
    if (TIMER_TYPES.includes(g.type) && g.data.timer) {
      const ms = timerMs(g.data.timer, now);
      v[`g_${k}_timer`] = fmt(ms, g.data.timer.mode);
      v[`g_${k}_timer_s`] = String(g.data.timer.mode === 'up' ? Math.floor(ms / 1000) : Math.ceil(ms / 1000 - 1e-6));
      v[`g_${k}_timer_running`] = String(!!g.data.timer.running);
    }
    if (g.type === 'score') {
      v[`g_${k}_score_a`] = String(g.data.scoreA); v[`g_${k}_score_b`] = String(g.data.scoreB);
      v[`g_${k}_team_a`] = String(g.data.teamA); v[`g_${k}_team_b`] = String(g.data.teamB);
    }
    const st = stepInfo(g);
    if (st) {
      v[`g_${k}_index`] = String(st.index + 1); v[`g_${k}_count`] = String(st.count);
      v[`g_${k}_current`] = st.current.replace(/\n/g, ' / '); v[`g_${k}_next`] = st.next.replace(/\n/g, ' / ');
    }
  }
  for (const [name, val] of Object.entries(p.variables.text)) v[`var_${slug(name)}`] = String(val);
  for (const [name, l] of Object.entries(p.variables.lists)) {
    v[`list_${slug(name)}`] = String((l.items || [])[l.index || 0] || '');
    v[`list_${slug(name)}_pos`] = `${(l.index || 0) + 1}/${(l.items || []).length}`;
  }
  return v;
}

module.exports = { oldestPending, buildVariables, computeVariables, graphicKeys, slug, timerMs, TIMER_TYPES };
