'use strict';
/* Publikum: Q&A (Moderation, Sperrwörter, Likes, aktiv/gelöst) und Umfragen (Auswahl, Mehrfachauswahl, Wortwolke, Bewertung) */
const crypto = require('crypto');

const uid = (n = 8) => crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, n);

class AudienceError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const DEFAULT_QA = {
  open: true, requireName: false, title: 'Stell deine Frage',
  moderation: true, blockedWords: '', blockedAction: 'moderate',
  allowLikes: true, showQuestions: true, maxLength: 300, allowAnonymous: true
};

/* ---------------- Sperrwörter ---------------- */
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$]/g, (c) => LEET[c] || c);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Liste aus Text: ein Eintrag pro Zeile oder durch Komma getrennt. "wort*" = Wortanfang, "*wort*" = irgendwo im Wort */
function compileBlocked(list) {
  const entries = String(list || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  return entries.map((raw) => {
    const pre = raw.startsWith('*'), post = raw.endsWith('*');
    const core = raw.replace(/^\*+|\*+$/g, '');
    if (!core) return null;
    const build = (txt) => new RegExp(`${pre ? '' : '(?<![\\p{L}\\p{N}])'}${escapeRe(txt)}${post ? '' : '(?![\\p{L}\\p{N}])'}`, 'giu');
    return { raw, norm: build(normalize(core)), orig: build(core.toLowerCase()) };
  }).filter(Boolean);
}

function checkBlocked(text, compiled) {
  const n = normalize(text);
  const hits = [];
  for (const c of compiled) { c.norm.lastIndex = 0; if (c.norm.test(n)) hits.push(c.raw); }
  return hits;
}

function censor(text, compiled) {
  // 1. Wortweise prüfen (erkennt auch Schreibweisen wie "Sch31ße"), 2. mehrteilige Einträge direkt ersetzen
  let out = String(text).replace(/[\p{L}\p{N}@$]+/gu, (word) => {
    const n = normalize(word);
    for (const c of compiled) { c.norm.lastIndex = 0; if (c.norm.test(n)) return '*'.repeat(Math.max(3, word.length)); }
    return word;
  });
  for (const c of compiled) { c.orig.lastIndex = 0; out = out.replace(c.orig, (m) => '*'.repeat(Math.max(3, m.length))); }
  return out;
}

/* ---------------- Migration ---------------- */
function migrateAudience(p) {
  p.qaSettings = Object.assign({}, DEFAULT_QA, p.qaSettings || {});
  p.questions = (p.questions || []).map((q) => {
    const out = Object.assign({ likes: 0, likedBy: [], active: false, resolved: false, flagged: [], voter: '' }, q);
    if (out.status === 'new') out.status = 'pending';
    else if (out.status === 'approved') out.status = 'live';
    else if (out.status === 'shown') { out.status = 'live'; out.active = true; }
    else if (out.status === 'archived') { out.status = 'live'; out.resolved = true; }
    if (!['pending', 'live', 'rejected'].includes(out.status)) out.status = 'pending';
    out.likes = Array.isArray(out.likedBy) ? out.likedBy.length : (Number(out.likes) || 0);
    return out;
  });
  p.polls = (p.polls || []).map((x) => Object.assign({ type: 'choice', showResults: false, maxChoices: 2, maxWords: 3, scale: 5, words: {}, ratings: [] }, x));
  for (const poll of p.polls) {
    if (poll.respondents === undefined || poll.respondents === null || (poll.respondents === 0 && poll.options.some((o) => o.votes > 0))) {
      // ältere Projekte: Teilnehmende schätzen
      poll.respondents = poll.type === 'multi' ? Math.max(0, ...poll.options.map((o) => o.votes)) : poll.options.reduce((s, o) => s + o.votes, 0);
    }
    if (!Array.isArray(poll.ratings) || poll.ratings.length !== poll.scale) poll.ratings = Array.from({ length: poll.scale }, (_, i) => (poll.ratings && poll.ratings[i]) || 0);
    if (!poll.words || typeof poll.words !== 'object') poll.words = {};
  }
  return p;
}

/* Sortierung für Fragenlisten (Grafik, Steuerung, Publikum) */
function sortQuestions(list, mode) {
  const arr = list.slice();
  if (mode === 'newest') arr.sort((a, b) => b.ts - a.ts);
  else if (mode === 'oldest') arr.sort((a, b) => a.ts - b.ts);
  else arr.sort((a, b) => (b.likes - a.likes) || (a.ts - b.ts));
  return arr;
}

/* ---------------- Befehle ---------------- */
function createAudience(server) {
  const voters = new Map();           // pollId -> Map(voter -> Antwort)
  let blockedCache = { src: null, compiled: [] };
  const compiled = () => {
    const src = server.project.qaSettings.blockedWords || '';
    if (blockedCache.src !== src) blockedCache = { src, compiled: compileBlocked(src) };
    return blockedCache.compiled;
  };
  const findQ = (id) => {
    const q = server.project.questions.find((x) => x.id === id);
    if (!q) throw new AudienceError(404, 'Frage nicht gefunden');
    return q;
  };
  const findPoll = (id) => {
    const poll = server.project.polls.find((x) => x.id === id);
    if (!poll) throw new AudienceError(404, 'Umfrage nicht gefunden');
    return poll;
  };
  const setActive = (q, on) => {
    for (const x of server.project.questions) if (x !== q) x.active = false;
    q.active = !!on;
    if (on) { q.resolved = false; if (q.status !== 'live') q.status = 'live'; }
  };
  const pollVoters = (poll) => { let m = voters.get(poll.id); if (!m) { m = new Map(); voters.set(poll.id, m); } return m; };
  const cleanVoter = (v) => String(v || '').replace(/[^\w-]/g, '').slice(0, 64);

  function exec(cmd, a) {
    const p = server.project;
    const qs = p.qaSettings;
    const now = Date.now();
    switch (cmd) {
      /* ---------- Q&A ---------- */
      case 'qa.submit': {
        if (!qs.open) throw new AudienceError(403, 'Fragen sind gerade geschlossen');
        let text = String(a.text || '').replace(/\s+\n/g, '\n').trim().slice(0, Math.max(20, Number(qs.maxLength) || 300));
        if (!text) throw new AudienceError(400, 'Leere Frage');
        let author = String(a.author || '').trim().slice(0, 60);
        if (qs.requireName && !author) throw new AudienceError(400, 'Bitte Namen angeben');
        const hits = checkBlocked(text + ' ' + author, compiled());
        let status = qs.moderation ? 'pending' : 'live';
        if (hits.length) {
          if (qs.blockedAction === 'reject') status = 'rejected';
          else if (qs.blockedAction === 'censor') { text = censor(text, compiled()); author = censor(author, compiled()); }
          else status = 'pending';
        }
        const q = { id: uid(8), author: author || 'Anonym', text, ts: now, status, active: false, resolved: false, likes: 0, likedBy: [], flagged: hits, voter: cleanVoter(a.voter) };
        p.questions.push(q);
        if (p.questions.length > 2000) p.questions.splice(0, p.questions.length - 2000);
        // Abgelehnte Fragen bekommen für Einreichende denselben neutralen Hinweis wie wartende
        return { id: q.id, status: status === 'rejected' ? 'pending' : status };
      }
      case 'qa.like': {
        if (!qs.allowLikes) throw new AudienceError(403, 'Likes sind deaktiviert');
        const q = findQ(a.id);
        const voter = cleanVoter(a.voter);
        if (!voter) throw new AudienceError(400, 'Fehlende Kennung');
        if (q.status !== 'live') throw new AudienceError(403, 'Frage ist nicht freigegeben');
        const i = q.likedBy.indexOf(voter);
        if (i >= 0) q.likedBy.splice(i, 1); else q.likedBy.push(voter);
        q.likes = q.likedBy.length;
        return { liked: i < 0, likes: q.likes };
      }
      case 'qa.approve': { const q = findQ(a.id); q.status = 'live'; return true; }
      case 'qa.approveAll': {
        // Fragen mit Sperrwort-Treffer bleiben zur manuellen Prüfung stehen
        let n = 0;
        for (const q of p.questions) if (q.status === 'pending' && (a.includeFlagged || !(q.flagged || []).length)) { q.status = 'live'; n++; }
        return { count: n };
      }
      case 'qa.reject': { const q = findQ(a.id); q.status = 'rejected'; q.active = false; return true; }
      case 'qa.pending': { const q = findQ(a.id); q.status = 'pending'; q.active = false; return true; }
      case 'qa.active': { const q = findQ(a.id); setActive(q, a.on === undefined ? !q.active : !!a.on); return { active: q.active }; }
      case 'qa.resolve': {
        const q = findQ(a.id);
        q.resolved = a.on === undefined ? !q.resolved : !!a.on;
        if (q.resolved) q.active = false;
        return { resolved: q.resolved };
      }
      case 'qa.activeNext': {
        const cur = p.questions.find((x) => x.active);
        if (cur && a.resolvePrevious !== false) { cur.resolved = true; cur.active = false; }
        const pool = sortQuestions(p.questions.filter((x) => x.status === 'live' && !x.resolved && x !== cur), a.sort || 'likes');
        const next = pool[0];
        if (next) setActive(next, true); else if (cur) cur.active = false;
        return { id: next ? next.id : null };
      }
      case 'qa.resolveActive': {
        const cur = p.questions.find((x) => x.active);
        if (cur) { cur.resolved = true; cur.active = false; }
        return { id: cur ? cur.id : null };
      }
      case 'qa.edit': {
        const q = findQ(a.id);
        if (a.text !== undefined) q.text = String(a.text).slice(0, 2000);
        if (a.author !== undefined) q.author = String(a.author).slice(0, 60) || 'Anonym';
        q.edited = true;
        return true;
      }
      case 'qa.status': {
        // Kompatibilität zu älteren Versionen/Companion
        const q = findQ(a.id);
        const st = a.status;
        if (st === 'approved' || st === 'live') q.status = 'live';
        else if (st === 'new' || st === 'pending') q.status = 'pending';
        else if (st === 'rejected') q.status = 'rejected';
        else if (st === 'archived' || st === 'resolved') { q.resolved = true; q.active = false; }
        else if (st === 'shown' || st === 'active') setActive(q, true);
        return true;
      }
      case 'qa.remove': p.questions = p.questions.filter((x) => x.id !== a.id); return true;
      case 'qa.clear': {
        const scope = a.scope || (a.all ? 'all' : 'resolved');
        p.questions = p.questions.filter((x) => scope === 'all' ? false : scope === 'rejected' ? x.status !== 'rejected' : !(x.resolved || x.status === 'rejected'));
        return true;
      }
      case 'qa.resetLikes': for (const q of p.questions) { q.likedBy = []; q.likes = 0; } return true;
      case 'qa.settings': {
        const keys = ['open', 'requireName', 'title', 'moderation', 'blockedWords', 'blockedAction', 'allowLikes', 'showQuestions', 'maxLength', 'allowAnonymous'];
        for (const k of keys) if (a[k] !== undefined) qs[k] = a[k];
        qs.maxLength = Math.max(20, Math.min(2000, Number(qs.maxLength) || 300));
        if (!['reject', 'moderate', 'censor'].includes(qs.blockedAction)) qs.blockedAction = 'moderate';
        return true;
      }
      case 'qa.test': {
        // Sperrwörter testen (Steuerung)
        const c = compileBlocked(a.list !== undefined ? a.list : qs.blockedWords);
        return { hits: checkBlocked(a.text || '', c), censored: censor(a.text || '', c) };
      }

      /* ---------- Umfragen ---------- */
      case 'poll.create': {
        const type = ['choice', 'multi', 'wordcloud', 'rating'].includes(a.type) ? a.type : 'choice';
        const opts = (a.options || (type === 'choice' || type === 'multi' ? ['Ja', 'Nein'] : [])).map((t) => ({ id: uid(5), text: String(t), votes: 0 }));
        const scale = Math.max(2, Math.min(10, Number(a.scale) || 5));
        const poll = { id: uid(6), question: a.question || 'Neue Umfrage', type, options: opts, open: false, showResults: !!a.showResults, maxChoices: Number(a.maxChoices) || 2, maxWords: Number(a.maxWords) || 3, scale, words: {}, ratings: new Array(scale).fill(0), respondents: 0 };
        p.polls.push(poll);
        return { id: poll.id };
      }
      case 'poll.update': {
        const poll = findPoll(a.id);
        if (a.question !== undefined) poll.question = String(a.question);
        if (Array.isArray(a.options)) {
          poll.options = a.options.map((o) => {
            const text = typeof o === 'string' ? o : o.text;
            const ex = poll.options.find((x) => (o && o.id && x.id === o.id) || x.text === text);
            return { id: ex ? ex.id : uid(5), text: String(text), votes: ex ? ex.votes : 0 };
          });
        }
        for (const k of ['open', 'showResults']) if (a[k] !== undefined) poll[k] = !!a[k];
        if (a.maxChoices !== undefined) poll.maxChoices = Math.max(1, Math.min(20, Number(a.maxChoices) || 2));
        if (a.maxWords !== undefined) poll.maxWords = Math.max(1, Math.min(10, Number(a.maxWords) || 3));
        if (a.type !== undefined && ['choice', 'multi', 'wordcloud', 'rating'].includes(a.type) && a.type !== poll.type) {
          poll.type = a.type; resetPoll(poll);
        }
        if (a.scale !== undefined) {
          const sc = Math.max(2, Math.min(10, Number(a.scale) || 5));
          if (sc !== poll.scale) { poll.scale = sc; poll.ratings = new Array(sc).fill(0); voters.delete(poll.id); }
        }
        if (a.open === true && a.exclusive) for (const o of p.polls) if (o !== poll) o.open = false;
        return true;
      }
      case 'poll.reset': resetPoll(findPoll(a.id)); return true;
      case 'poll.remove': p.polls = p.polls.filter((x) => x.id !== a.id); voters.delete(a.id); return true;
      case 'poll.removeWord': {
        const poll = findPoll(a.id);
        delete poll.words[normalizeWord(a.word)];
        return true;
      }
      case 'poll.vote': {
        const poll = findPoll(a.pollId);
        if (!poll.open) throw new AudienceError(403, 'Umfrage ist nicht geöffnet');
        const voter = cleanVoter(a.voter);
        if (!voter) throw new AudienceError(400, 'Fehlende Kennung');
        const vm = pollVoters(poll);
        const prev = vm.get(voter);
        const firstVote = !vm.has(voter);
        if (poll.type === 'choice' || poll.type === 'multi') {
          let ids = poll.type === 'multi' ? (Array.isArray(a.optionIds) ? a.optionIds : [a.optionId]) : [a.optionId];
          ids = [...new Set(ids.filter((id) => poll.options.some((o) => o.id === id)))];
          if (!ids.length) throw new AudienceError(400, 'Bitte eine Antwort wählen');
          if (poll.type === 'multi' && ids.length > poll.maxChoices) throw new AudienceError(400, `Höchstens ${poll.maxChoices} Antworten`);
          for (const id of prev || []) { const o = poll.options.find((x) => x.id === id); if (o) o.votes = Math.max(0, o.votes - 1); }
          for (const id of ids) poll.options.find((x) => x.id === id).votes++;
          vm.set(voter, ids);
          if (firstVote) poll.respondents = (poll.respondents || 0) + 1;
          return { answer: ids };
        }
        if (poll.type === 'rating') {
          const v = Math.round(Number(a.value));
          if (!(v >= 1 && v <= poll.scale)) throw new AudienceError(400, 'Ungültige Bewertung');
          if (prev) poll.ratings[prev - 1] = Math.max(0, poll.ratings[prev - 1] - 1);
          poll.ratings[v - 1]++;
          vm.set(voter, v);
          if (firstVote) poll.respondents = (poll.respondents || 0) + 1;
          return { answer: v };
        }
        // Wortwolke: mehrere Begriffe pro Person bis maxWords
        const list = prev || [];
        const words = (Array.isArray(a.words) ? a.words : [a.words]).map((w) => String(w || '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean);
        if (!words.length) throw new AudienceError(400, 'Bitte einen Begriff eingeben');
        const c = compiled();
        let added = 0;
        for (const w of words) {
          if (list.length >= poll.maxWords) break;
          if (checkBlocked(w, c).length) continue;
          const key = normalizeWord(w);
          if (!key || list.includes(key)) continue;
          if (!poll.words[key]) poll.words[key] = { text: w, count: 0 };
          poll.words[key].count++;
          list.push(key);
          added++;
        }
        vm.set(voter, list);
        if (firstVote && added) poll.respondents = (poll.respondents || 0) + 1;
        if (!added) throw new AudienceError(400, list.length >= poll.maxWords ? `Höchstens ${poll.maxWords} Begriffe` : 'Begriff nicht erlaubt oder bereits abgegeben');
        return { answer: list, left: poll.maxWords - list.length };
      }
    }
    return undefined;

    function resetPoll(poll) {
      poll.options.forEach((o) => { o.votes = 0; });
      poll.words = {};
      poll.ratings = new Array(poll.scale).fill(0);
      poll.respondents = 0;
      voters.delete(poll.id);
    }
  }

  /* Öffentliche Daten für die Publikumsseite (für alle gleich) */
  function publicState() {
    const p = server.project, qs = p.qaSettings;
    const questions = qs.showQuestions ? p.questions.filter((q) => q.status === 'live').map((q) => ({ id: q.id, author: q.author, text: q.text, likes: q.likes, active: q.active, resolved: q.resolved, ts: q.ts })) : [];
    return {
      t: 'audience', title: p.name,
      qa: { open: qs.open, requireName: qs.requireName, title: qs.title, allowLikes: qs.allowLikes, showQuestions: qs.showQuestions, maxLength: qs.maxLength, moderation: qs.moderation },
      questions,
      polls: p.polls.filter((x) => x.open).map((x) => {
        const o = { id: x.id, question: x.question, type: x.type, showResults: x.showResults, maxChoices: x.maxChoices, maxWords: x.maxWords, scale: x.scale, options: x.options.map((op) => ({ id: op.id, text: op.text })) };
        if (x.showResults) o.results = pollResults(x);
        return o;
      })
    };
  }

  /* Persönliche Daten: eigene (noch nicht freigegebene) Fragen, eigene Likes und Stimmen */
  function personalState(voter) {
    const v = cleanVoter(voter);
    if (!v) return { mine: [], liked: [], votes: {} };
    const p = server.project;
    const mine = p.questions.filter((q) => q.voter === v).map((q) => ({ id: q.id, text: q.text, status: q.status === 'rejected' ? 'pending' : q.status, resolved: q.resolved }));
    const liked = p.questions.filter((q) => q.likedBy.includes(v)).map((q) => q.id);
    const votes = {};
    for (const poll of p.polls) {
      const m = voters.get(poll.id);
      if (!m || !m.has(v)) continue;
      const ans = m.get(v);
      votes[poll.id] = poll.type === 'wordcloud' ? ans.map((k) => (poll.words[k] ? poll.words[k].text : k)) : ans;
    }
    return { mine, liked, votes };
  }

  return { exec, publicState, personalState, reset: () => voters.clear() };
}

function normalizeWord(w) { return normalize(w).replace(/[^\p{L}\p{N} ]/gu, '').trim(); }

function pollResults(poll) {
  if (poll.type === 'rating') {
    const total = poll.ratings.reduce((s, n) => s + n, 0);
    const sum = poll.ratings.reduce((s, n, i) => s + n * (i + 1), 0);
    return { total, average: total ? Math.round((sum / total) * 10) / 10 : 0, ratings: poll.ratings.slice() };
  }
  if (poll.type === 'wordcloud') {
    const words = Object.values(poll.words).filter((w) => w.count > 0).sort((a, b) => b.count - a.count).slice(0, 60);
    return { total: words.reduce((s, w) => s + w.count, 0), words };
  }
  const total = poll.options.reduce((s, o) => s + o.votes, 0);
  return { total, respondents: poll.respondents || 0, options: poll.options.map((o) => ({ id: o.id, votes: o.votes })) };
}

module.exports = { createAudience, migrateAudience, compileBlocked, checkBlocked, censor, normalize, sortQuestions, pollResults, DEFAULT_QA, AudienceError };
