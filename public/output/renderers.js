/* CueGFX – Renderer für alle Grafiktypen. Jede Fabrik liefert { el, update(g, ctx), tick?(now, ctx), destroy?() }. */
(function () {
  'use strict';
  const T = window.CueTypes;
  const R = {};

  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const div = (cls, html) => { const d = document.createElement('div'); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; };
  const timerText = (d, now) => {
    const t = d.timer || {};
    const v = T.timerValueMs(t, now);
    if (t.mode === 'up') return { text: T.formatCountUp(v, d.format || 'auto'), ms: v, over: false };
    if (v < 0 && !d.allowOverrun) return { text: d.endText || T.formatDuration(0, d.format || 'auto'), ms: 0, over: false, ended: true };
    if (v <= 0 && d.endText && v > -1000) return { text: d.endText, ms: v, over: false, ended: true };
    return { text: T.formatDuration(v, d.format || 'auto'), ms: v, over: v < 0 };
  };
  const setText = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };
  const setHtml = (el, html) => { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } };
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  /* ---------------- Bauchbinde ---------------- */
  R.lowerthird = () => {
    const el = div('lt');
    return {
      el,
      update(g, c) {
        const d = g.data;
        el.className = `lt lt-${d.style}${d.logo ? ' has-logo' : ''}`;
        el.dataset.align = d.align;
        el.style.setProperty('--c1', d.color1 || '');
        el.style.setProperty('--c2', d.color2 || '');
        if (!d.color1) el.style.removeProperty('--c1');
        if (!d.color2) el.style.removeProperty('--c2');
        const name = c.sub(d.name), title = c.sub(d.title);
        setHtml(el, (d.logo ? `<div class="lt-logo"><img src="${esc(c.media(d.logo))}"></div>` : '') +
          `<div class="lt-txt"><div class="lt-name">${nl(name)}</div>${title ? `<div class="lt-title">${nl(title)}</div>` : ''}</div>`);
      }
    };
  };

  /* ---------------- Animierte Bauchbinde ---------------- */
  R.lowerthird_anim = () => {
    const el = div('lta');
    let style = '';
    const split = (s) => [...s].map((ch, i) => `<span class="ch" style="--i:${i}">${esc(ch)}</span>`).join('');
    return {
      el, customAnim: true,
      update(g, c) {
        const d = g.data;
        style = d.style;
        const name = c.sub(d.name), title = c.sub(d.title);
        const isStagger = style === 'stagger';
        el.style.setProperty('--ac', d.accent || 'var(--accent)');
        setHtml(el, (d.logo ? `<div class="lta-logo"><img src="${esc(c.media(d.logo))}"></div>` : '') +
          `<div class="lta-body"><div class="bar"></div><div class="lta-name"><span>${isStagger ? split(name) : esc(name)}</span></div>` +
          (title ? `<div class="lta-title"><span>${isStagger ? split(title) : esc(title)}</span></div>` : '') + '</div>');
        const st = el.classList.contains('out') ? 'out' : 'in';
        el.className = `lta lta-${style} ${st}`;
      },
      animIn() { el.classList.remove('out'); el.classList.add('in'); },
      animOut() { el.classList.remove('in'); el.classList.add('out'); return 500; }
    };
  };

  /* ---------------- Nachricht ---------------- */
  R.message = () => {
    const el = div('msg');
    return {
      el,
      update(g, c) {
        const d = g.data;
        el.className = `msg msg-${d.style}`;
        el.style.width = d.width ? d.width + 'px' : '';
        const h = c.sub(d.heading), b = c.sub(d.body);
        setHtml(el, (h ? `<h2>${nl(h)}</h2>` : '') + (b ? `<p>${nl(b)}</p>` : ''));
      }
    };
  };

  /* ---------------- Ticker ---------------- */
  R.ticker = () => {
    const el = div('ticker', '<div class="tk-label"></div><div class="tk-view"><div class="tk-track"></div><div class="tk-flip"></div></div>');
    const label = el.querySelector('.tk-label'), view = el.querySelector('.tk-view'), track = el.querySelector('.tk-track'), flip = el.querySelector('.tk-flip');
    let unitW = 0, speed = 120, mode = 'scroll', items = [], flipSec = 6, lastFlip = -1, shownAt = 0, contentKey = '';
    return {
      el, needsTick: true,
      update(g, c) {
        const d = g.data;
        shownAt = g.shownAt || c.now();
        speed = Math.max(10, Number(d.speed) || 120);
        mode = d.mode; flipSec = Math.max(1, Number(d.flipSeconds) || 6);
        el.className = `ticker at-${d.placement || 'bottom'}`;
        el.style.setProperty('--tm', (Number(d.margin) || 0) + 'px');
        label.style.display = d.label ? '' : 'none';
        setText(label, c.sub(d.label));
        items = (d.items || []).map((it) => c.sub(it.text)).filter((s) => s.trim());
        const sep = `<span class="tk-sep">${esc(d.separator)}</span>`;
        const unit = items.map((t) => `<span class="tk-item">${esc(t)}</span>${sep}`).join('');
        track.style.display = mode === 'scroll' ? '' : 'none';
        flip.style.display = mode === 'flip' ? '' : 'none';
        if (mode === 'scroll' && unit !== contentKey) {
          contentKey = unit;
          track.innerHTML = `<span class="tk-unit" style="display:flex">${unit}</span>`;
          unitW = track.firstChild.offsetWidth;
          const reps = Math.max(2, Math.ceil(1920 / Math.max(1, unitW)) + 1);
          track.innerHTML = Array(reps).fill(`<span class="tk-unit" style="display:flex">${unit}</span>`).join('');
        }
        lastFlip = -1;
      },
      tick(now) {
        const el2 = (now - shownAt) / 1000;
        if (mode === 'scroll') {
          if (unitW > 0) {
            // Startet am rechten Rand und läuft dann nahtlos über die wiederholten Einheiten
            const x = (view.clientWidth || 1600) - el2 * speed;
            const off = x > 0 ? x : -((-x) % unitW);
            track.style.transform = `translate3d(${off}px,0,0)`;
          }
        } else if (items.length) {
          const idx = Math.floor(el2 / flipSec) % items.length;
          if (idx !== lastFlip) {
            const first = lastFlip === -1;
            lastFlip = idx;
            if (first) { flip.textContent = items[idx]; flip.classList.remove('hide'); }
            else {
              flip.classList.add('hide');
              setTimeout(() => { flip.textContent = items[idx]; flip.classList.remove('hide'); }, 350);
            }
          }
        }
      }
    };
  };

  /* ---------------- Social / Chat ---------------- */
  const PLATFORM = { twitch: ['#9146ff', 'T'], youtube: ['#ff0000', '▶'], instagram: ['#d62976', 'IG'], x: ['#000', 'X'], facebook: ['#1877f2', 'f'], tiktok: ['#010101', '♪'], kick: ['#53fc18', 'K'], custom: ['var(--primary)', '★'] };
  R.social = () => {
    const el = div('soc');
    return {
      el,
      update(g, c) {
        const d = g.data;
        const pf = PLATFORM[d.platform] || PLATFORM.custom;
        const author = c.sub(d.author);
        el.style.setProperty('--nc', d.color || 'var(--primary)');
        // Avatar als Bild über den Initialen – lädt es nicht (z. B. abgelaufener Link), bleiben die Initialen sichtbar
        const av = d.avatar ? `<img class="avi" src="${esc(c.media(d.avatar))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
        setHtml(el, `<div class="av">${esc(initials(author))}${av}<div class="pf" style="background:${pf[0]}">${pf[1]}</div></div>` +
          `<div><div class="who">${esc(author)}</div><div class="txt">${nl(c.sub(d.message))}</div></div>`);
      }
    };
  };

  /* ---------------- Publikumsfrage ---------------- */
  R.qa = () => {
    const el = div('qa');
    return {
      el,
      update(g, c) {
        const d = g.data;
        setHtml(el, (d.heading ? `<div class="qa-h">${esc(c.sub(d.heading))}</div>` : '') +
          `<div class="qa-q">${nl(c.sub(d.question))}</div>` + (d.author ? `<div class="qa-a">— ${esc(c.sub(d.author))}</div>` : ''));
      }
    };
  };

  /* ---------------- Bild ---------------- */
  R.image = () => {
    const el = div('');
    const img = document.createElement('img');
    img.className = 'img-el';
    el.appendChild(img);
    return {
      el,
      update(g, c) {
        const d = g.data;
        const src = c.media(d.src);
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        c.setFull(!!d.fullscreen);
        if (d.fullscreen) { img.className = 'img-el media-full'; img.style.width = ''; img.style.height = ''; }
        else { img.className = 'img-el'; img.style.width = d.width > 0 ? d.width + 'px' : ''; img.style.height = d.height > 0 ? d.height + 'px' : ''; }
        img.style.objectFit = d.fit;
        img.style.opacity = (Number(d.opacity) || 0) / 100;
        img.style.borderRadius = (Number(d.radius) || 0) + 'px';
      }
    };
  };

  /* ---------------- Video & Audio ---------------- */
  function mediaPlayer(kind) {
    return () => {
      const el = div('');
      const m = document.createElement(kind);
      m.playsInline = true; m.preload = 'auto';
      if (kind === 'video') m.className = 'vid-el';
      el.appendChild(m);
      let cur = null, shownAt = 0, ctxRef = null, endedSent = false, fadeTimer = null;
      const finish = () => {
        if (!cur) return;
        if (cur.data.loop) { m.currentTime = Number(cur.data.trimStart) || 0; m.play().catch(() => {}); return; }
        m.pause();
        if (!endedSent) { endedSent = true; ctxRef.ended(cur); }
      };
      m.addEventListener('ended', finish);
      m.addEventListener('timeupdate', () => {
        const te = Number(cur && cur.data.trimEnd) || 0;
        if (te > 0 && m.currentTime >= te) finish();
      });
      const startPlayback = (c) => {
        const d = cur.data;
        const ts = Number(d.trimStart) || 0;
        const since = Math.max(0, (c.now() - shownAt) / 1000);
        const go = () => {
          // Synchron mit anderen Ausgängen starten, wenn die Grafik schon läuft
          let pos = ts + (since < 2 ? since : 0);
          if (since >= 2 && m.duration && !d.loop) pos = Math.min(m.duration, ts + since);
          try { m.currentTime = pos; } catch (_) {}
          const vol = Math.max(0, Math.min(1, (Number(d.volume) || 0) / 100));
          if (kind === 'audio' && Number(d.fadeIn) > 0) {
            m.volume = 0;
            const steps = 20, dur = Number(d.fadeIn) * 1000;
            let i = 0;
            clearInterval(fadeTimer);
            fadeTimer = setInterval(() => { i++; m.volume = vol * Math.min(1, i / steps); if (i >= steps) clearInterval(fadeTimer); }, dur / steps);
          } else m.volume = vol;
          const p = m.play();
          if (p) p.catch(() => { m.muted = true; m.play().catch(() => {}); });
        };
        if (m.readyState >= 1) go(); else m.addEventListener('loadedmetadata', go, { once: true });
      };
      return {
        el,
        update(g, c) {
          ctxRef = c;
          if (c.sink && !c.monitor && !m._sinkReg) { m._sinkReg = true; c.sink.add(m); }
          const d = g.data;
          const src = c.media(d.src);
          const restart = !cur || g.shownAt !== shownAt || m.getAttribute('src') !== src;
          cur = g;
          if (kind === 'video') {
            c.setFull(!!d.fullscreen);
            m.className = d.fullscreen ? 'vid-el media-full' : 'vid-el';
            m.style.width = d.fullscreen ? '' : (d.width > 0 ? d.width + 'px' : '');
            m.style.objectFit = d.fit;
          }
          m.loop = false;
          // Monitor in der Steuerung: Ton nur messen (nicht hörbar), sonst normal stummschalten
          if (c.monitor && c.monitor.attach(g.id, m, () => cur)) m.muted = !!d.muted;
          else m.muted = !!d.muted || !c.audio;
          if (!restart) { m.volume = Math.max(0, Math.min(1, (Number(d.volume) || 0) / 100)); return; }
          shownAt = g.shownAt;
          endedSent = false;
          if (m.getAttribute('src') !== src) m.setAttribute('src', src);
          if (src) startPlayback(c);
        },
        destroy() { clearInterval(fadeTimer); if (ctxRef && ctxRef.sink) ctxRef.sink.remove(m); if (cur && ctxRef && ctxRef.monitor) ctxRef.monitor.detach(cur.id); m.pause(); m.removeAttribute('src'); m.load(); }
      };
    };
  }
  R.video = mediaPlayer('video');
  R.audio = mediaPlayer('audio');

  /* ---------------- Spielstand ---------------- */
  R.score = () => {
    const el = div('sc');
    let last = {}, data = null, clockEl = null;
    return {
      el, needsTick: true,
      update(g, c) {
        const d = g.data; data = d;
        const teams = T.scoreTeams(d);
        const info = (d.period || d.showClock) ? `<div class="sc-info">${d.period ? `<div>${esc(c.sub(d.period))}</div>` : ''}${d.showClock ? '<div class="clock"></div>' : ''}</div>` : '';
        if (teams.length <= 2) {
          // Klassisch: Heim gegen Gast
          const team = (t) => `<div class="sc-team ${t.key}" style="--tc:${esc(t.color)}">${t.logo ? `<img src="${esc(c.media(t.logo))}">` : ''}<span>${esc(c.sub(t.name))}</span></div>`;
          const score = (t) => `<div class="sc-score ${t.key}" data-team="${t.key}" style="--tc:${esc(t.color)}">${esc(t.score)}</div>`;
          el.className = `sc ${d.style}`;
          setHtml(el, `<div class="sc-row">${team(teams[0])}${score(teams[0])}${score(teams[1])}${team(teams[1])}</div>${info}`);
        } else {
          // Ab drei Teams: Tabelle, optional nach Punkten sortiert
          const rows = d.sortTeams ? teams.slice().sort((x, y) => y.score - x.score) : teams;
          el.className = `sc multi ${d.style}`;
          setHtml(el, `<div class="sc-table">${rows.map((t) => `<div class="sc-line" style="--tc:${esc(t.color)}">`
            + `<div class="sc-team ${t.key}">${t.logo ? `<img src="${esc(c.media(t.logo))}">` : ''}<span>${esc(c.sub(t.name))}</span></div>`
            + `<div class="sc-score" data-team="${t.key}">${esc(t.score)}</div></div>`).join('')}</div>${info}`);
        }
        clockEl = el.querySelector('.clock');
        const now = {};
        for (const t of teams) {
          now[t.key] = t.score;
          if (last[t.key] !== undefined && last[t.key] !== t.score) {
            const s = el.querySelector(`.sc-score[data-team="${t.key}"]`);
            if (s) { s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
          }
        }
        last = now;
      },
      tick(now) { if (clockEl && data) setText(clockEl, timerText(data, now).text); }
    };
  };

  /* ---------------- Glücksrad ---------------- */
  R.wheel = () => {
    const el = div('wh', '<div class="wh-title"></div><div class="wh-box"><canvas class="wh-fx"></canvas><svg class="wh-svg" viewBox="-520 -520 1040 1040"><g class="wh-rot"></g><g class="wh-hub"></g><path class="wh-ptr" d="M0,-468 L-34,-536 L34,-536 Z"/></svg><div class="wh-res"><small></small><b></b></div></div>');
    const titleEl = el.querySelector('.wh-title'), box = el.querySelector('.wh-box'), rot = el.querySelector('.wh-rot'), hub = el.querySelector('.wh-hub');
    const resEl = el.querySelector('.wh-res'), resSmall = resEl.querySelector('small'), resBig = resEl.querySelector('b');
    const fx = el.querySelector('.wh-fx'), fxc = fx.getContext('2d');
    let d = null, ctxRef = null, key = '', list = [], lastSeg = -1, ac = null, parts = [], lastFx = 0, burstFor = '', resultShown = '';
    const ease = (p) => 1 - Math.pow(1 - p, 4);
    const angleAt = (w, now) => {
      if (!w) return 0;
      if (!w.spinning) return Number(w.angle) || 0;
      const p = Math.max(0, Math.min(1, (now - w.startedAt) / (w.duration || 1)));
      return w.from + (w.to - w.from) * ease(p);
    };
    const palette = () => {
      const cs = String((d && d.colors) || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      if (cs.length) return cs;
      const st = getComputedStyle(document.documentElement);
      return ['--primary', '--accent', '--secondary'].map((v) => st.getPropertyValue(v).trim()).filter(Boolean).concat(['#16a34a', '#2563eb', '#9333ea']);
    };
    const textOn = (hex) => {
      const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || '');
      if (!m) return '#fff';
      const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
      return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
    };
    const draw = () => {
      const n = list.length, cols = palette(), R0 = 460;
      if (!n) { rot.innerHTML = '<circle r="460" fill="#333"/><text text-anchor="middle" dy="12" fill="#fff" font-size="40">Keine Felder</text>'; return; }
      const seg = 360 / n;
      // Schriftgröße: passt in die Segmentbreite und in die Strecke zwischen Nabe und Rand
      const base = Math.max(16, Math.min(64, 2 * Math.PI * 300 / n * 0.62));
      const fsFor = (t) => Math.max(14, Math.min(base, 340 / (Math.max(t.length, 3) * 0.6)));
      let html = '';
      list.forEach((label, i) => {
        const a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180;
        const c = (n > 1 && i === n - 1 && (n - 1) % cols.length === 0) ? cols[1 % cols.length] : cols[i % cols.length]; // Nachbarn nie gleichfarbig
        const large = seg > 180 ? 1 : 0;
        const path = n === 1 ? `<circle r="${R0}" fill="${esc(c)}"/>` : `<path d="M0,0 L${(Math.cos(a0) * R0).toFixed(1)},${(Math.sin(a0) * R0).toFixed(1)} A${R0},${R0} 0 ${large} 1 ${(Math.cos(a1) * R0).toFixed(1)},${(Math.sin(a1) * R0).toFixed(1)} Z" fill="${esc(c)}"/>`;
        const mid = i * seg + seg / 2;
        const txt = label.length > 28 ? label.slice(0, 27) + '…' : label;
        html += `${path}<g transform="rotate(${mid - 90})"><text x="${R0 - 34}" y="0" dy="0.35em" text-anchor="end" font-size="${fsFor(txt).toFixed(0)}" fill="${textOn(c)}">${esc(txt)}</text></g>`;
      });
      html += `<circle r="${R0}" class="wh-rim"/>`;
      for (let i = 0; i < n; i++) { const a = (i * seg - 90) * Math.PI / 180; html += `<circle class="wh-pin" cx="${(Math.cos(a) * (R0 - 8)).toFixed(1)}" cy="${(Math.sin(a) * (R0 - 8)).toFixed(1)}" r="7"/>`; }
      rot.innerHTML = html;
      hub.innerHTML = '<circle r="62" class="wh-hub-o"/><circle r="40" class="wh-hub-i"/>';
    };
    const click = () => {
      if (!d || !d.sound || !ctxRef || !ctxRef.audio) return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        const o = ac.createOscillator(), gn = ac.createGain(), t = ac.currentTime;
        o.type = 'square'; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
        gn.gain.setValueAtTime(0.18, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + 0.06);
      } catch (_) {}
    };
    const burst = () => {
      const cols = palette().concat(['#ffd166', '#ffffff']);
      const W = fx.width, H = fx.height;
      for (let i = 0; i < 160; i++) {
        const a = Math.random() * Math.PI * 2, v = 300 + Math.random() * 900;
        parts.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 300, w: 10 + Math.random() * 12, h: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 12, col: cols[(Math.random() * cols.length) | 0], life: 1 });
      }
    };
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data; ctxRef = c;
        const w = d.wheel || {};
        const S = Math.max(200, Math.min(1060, Number(d.size) || 720));
        el.style.setProperty('--whs', S + 'px');
        fx.width = fx.height = Math.round(S * 1.7);
        setText(titleEl, c.sub(d.title || '')); titleEl.style.display = d.title ? '' : 'none';
        list = w.spinning && Array.isArray(w.entries) ? w.entries : T.wheelEntries(d);
        const k = JSON.stringify([list, d.colors]);
        if (k !== key) { key = k; draw(); }
      },
      tick(now) {
        if (!d) return;
        const w = d.wheel || {};
        const ang = angleAt(w, now);
        rot.setAttribute('transform', `rotate(${ang.toFixed(2)})`);
        // Klick, wenn ein Stift den Zeiger passiert
        if (list.length > 1 && w.spinning) {
          const segIdx = Math.floor((((-ang) % 360 + 360) % 360) / (360 / list.length));
          if (segIdx !== lastSeg) { if (lastSeg !== -1) click(); lastSeg = segIdx; }
        } else lastSeg = -1;
        // Ergebnis-Nachricht
        const secs = Number(d.resultSeconds) || 0;
        const show = !!(d.showResult !== false && w.result && !w.spinning && !w.resultHidden && (!secs || now < w.resultAt + secs * 1000));
        if (show) {
          setText(resSmall, ctxRef ? ctxRef.sub(d.resultLabel || '') : (d.resultLabel || '')); resSmall.style.display = d.resultLabel ? '' : 'none';
          setText(resBig, w.result);
        }
        const id = show ? w.spinId + '|' + w.result : '';
        if (id !== resultShown) { resultShown = id; resEl.classList.toggle('on', show); }
        if (w.result && !w.spinning && d.confetti !== false && burstFor !== w.spinId && now - w.resultAt < 3000) { burstFor = w.spinId; burst(); }
        if (w.spinning) burstFor = '';
        // Konfetti
        if (parts.length) {
          const dt = lastFx ? Math.min(0.05, (now - lastFx) / 1000) : 0.016;
          fxc.clearRect(0, 0, fx.width, fx.height);
          parts = parts.filter((p) => {
            p.vy += 900 * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life -= dt * 0.45;
            fxc.save(); fxc.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5)); fxc.translate(p.x, p.y); fxc.rotate(p.r); fxc.fillStyle = p.col; fxc.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fxc.restore();
            return p.life > 0 && p.y < fx.height + 40;
          });
          if (!parts.length) fxc.clearRect(0, 0, fx.width, fx.height);
        }
        lastFx = now;
      },
      destroy() { try { ac && ac.close(); } catch (_) {} }
    };
  };

  /* ---------------- Rangliste ---------------- */
  R.leaderboard = () => {
    const el = div('lb', '<div class="lb-head"><div class="lb-title"></div><div class="lb-sub"></div></div><div class="lb-list"></div>');
    const head = el.querySelector('.lb-head'), titleEl = el.querySelector('.lb-title'), subEl = el.querySelector('.lb-sub'), listEl = el.querySelector('.lb-list');
    const rowsByKey = new Map(), lastScore = new Map();
    return {
      el,
      update(g, c) {
        const d = g.data;
        el.style.width = (Number(d.width) || 900) + 'px';
        el.classList.toggle('two', String(d.columns) === '2');
        el.classList.toggle('medals', d.medals !== false);
        el.classList.toggle('norank', d.showRank === false);
        setText(titleEl, c.sub(d.title || '')); setText(subEl, c.sub(d.subtitle || ''));
        titleEl.style.display = d.title ? '' : 'none'; subEl.style.display = d.subtitle ? '' : 'none';
        head.style.display = d.title || d.subtitle ? '' : 'none';
        const rows = T.boardRows(d).slice(0, Math.max(1, Number(d.lines) || 10));
        // Positionen vorher merken (für die Verschiebe-Animation)
        const before = new Map();
        for (const [k, r] of rowsByKey) before.set(k, { x: r.offsetLeft, y: r.offsetTop });
        const seen = new Map(), keep = new Set();
        const ordered = rows.map((r) => {
          const n = (seen.get(r.name) || 0) + 1; seen.set(r.name, n);
          const k = r.name + '#' + n;
          keep.add(k);
          let row = rowsByKey.get(k);
          if (!row) { row = div('lb-row', '<div class="lb-rank"></div><div class="lb-img"></div><div class="lb-name"><span></span><small></small></div><div class="lb-score"></div>'); rowsByKey.set(k, row); }
          row.dataset.rank = r.rank;
          setText(row.querySelector('.lb-rank'), String(r.rank));
          const imgBox = row.querySelector('.lb-img'), src = r.image ? c.media(r.image) : '';
          if (imgBox.dataset.src !== src) { imgBox.dataset.src = src; imgBox.innerHTML = src ? `<img src="${esc(src)}">` : ''; }
          imgBox.style.display = src ? '' : 'none';
          setText(row.querySelector('.lb-name span'), c.sub(r.name));
          const sm = row.querySelector('.lb-name small'); setText(sm, c.sub(r.note)); sm.style.display = r.note ? '' : 'none';
          const sc = row.querySelector('.lb-score');
          setText(sc, `${r.score}${d.scoreSuffix ? ' ' + d.scoreSuffix : ''}`);
          if (lastScore.has(k) && lastScore.get(k) !== r.score) { sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
          lastScore.set(k, r.score);
          return { k, row };
        });
        for (const [k, r] of rowsByKey) if (!keep.has(k)) { r.remove(); rowsByKey.delete(k); lastScore.delete(k); }
        const half = Math.ceil(ordered.length / 2);
        listEl.style.gridTemplateRows = String(d.columns) === '2' ? `repeat(${half}, auto)` : '';
        ordered.forEach(({ row }) => listEl.appendChild(row));
        // FLIP: von alter zu neuer Position gleiten
        for (const { k, row } of ordered) {
          const b = before.get(k);
          if (!b) { row.classList.remove('enter'); void row.offsetWidth; row.classList.add('enter'); continue; }
          const dx = b.x - row.offsetLeft, dy = b.y - row.offsetTop;
          if (!dx && !dy) continue;
          row.style.transition = 'none'; row.style.transform = `translate(${dx}px, ${dy}px)`;
          void row.offsetWidth;
          row.style.transition = ''; row.style.transform = '';
        }
      }
    };
  };

  /* ---------------- Webseite / Webvideo ---------------- */
  const embedUrl = (raw, d, c) => {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][\w+.-]*:/i.test(u)) u = 'https://' + u;
    if (d.embed === false) return u;
    const mute = d.muted || !c.audio ? 1 : 0, auto = d.autoplay === false ? 0 : 1;
    let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
    if (m) {
      const t = (u.match(/[?&]t=(\d+)/) || [])[1];
      return `https://www.youtube.com/embed/${m[1]}?autoplay=${auto}&mute=${mute}&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3${t ? '&start=' + t : ''}`;
    }
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return `https://player.vimeo.com/video/${m[1]}?autoplay=${auto}&muted=${mute}&controls=0&title=0&byline=0&portrait=0`;
    m = u.match(/twitch\.tv\/(?:videos\/(\d+)|([\w]+))\/?$/i);
    if (m && !/player\.twitch/.test(u)) return `https://player.twitch.tv/?${m[1] ? 'video=' + m[1] : 'channel=' + m[2]}&parent=${encodeURIComponent(location.hostname)}&autoplay=${auto ? 'true' : 'false'}&muted=${mute ? 'true' : 'false'}`;
    return u;
  };
  R.webpage = () => {
    const el = div('web');
    let frame = null, src = '', reloadKey = null, refreshTimer = null, refreshSecs = 0;
    const load = (url) => {
      if (frame) frame.remove();
      frame = document.createElement('iframe');
      frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.setAttribute('allowtransparency', 'true');
      frame.setAttribute('scrolling', 'no');
      frame.src = url || 'about:blank';
      el.appendChild(frame);
    };
    return {
      el,
      update(g, c) {
        const d = g.data;
        c.setFull(!!d.fullscreen);
        const z = Math.max(25, Math.min(400, Number(d.zoom) || 100)) / 100;
        el.classList.toggle('full', !!d.fullscreen);
        el.classList.toggle('opaque', d.transparent === false);
        if (d.fullscreen) { el.style.width = ''; el.style.height = ''; el.style.borderRadius = ''; }
        else { el.style.width = (Number(d.width) || 1280) + 'px'; el.style.height = (Number(d.height) || 720) + 'px'; el.style.borderRadius = (Number(d.radius) || 0) + 'px'; }
        el.style.setProperty('--wz', z);
        const url = embedUrl(c.sub(d.url), d, c);
        if (url !== src || d.reloadKey !== reloadKey) { src = url; reloadKey = d.reloadKey; load(url); }
        const r = Math.max(0, Number(d.refresh) || 0);
        if (r !== refreshSecs) {
          refreshSecs = r; clearInterval(refreshTimer); refreshTimer = null;
          if (r) refreshTimer = setInterval(() => load(src), Math.max(5, r) * 1000);
        }
      },
      destroy() { clearInterval(refreshTimer); if (frame) frame.src = 'about:blank'; }
    };
  };

  /* ---------------- Kamerarahmen (Spiele-Look) ---------------- */
  R.camframe = () => {
    const el = div('cf');
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; cv.className = 'fx-canvas';
    el.appendChild(cv);
    const x = cv.getContext('2d');
    const layer = document.createElement('canvas'); layer.width = 1920; layer.height = 1080;
    const lx = layer.getContext('2d');
    let d = null, ctxRef = null, key = '', parts = [], last = 0, fxSeen = null, shake = { until: 0, amp: 0 }, flash = null, glitchUntil = 0, texts = [], ac = null, t0 = 0;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (a) => a[(Math.random() * a.length) | 0];
    let seed = 1; const srnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    const MAT = {
      stone: ['#7d7d7d', '#6b6b6b', '#8f8f8f', '#5a5a5a', '#9a9a9a'],
      wood: ['#9c6b3c', '#8a5a2e', '#b07a45', '#6e4522', '#a8723f'],
      grass: ['#5fa53a', '#4e8f2e', '#6cb844', '#3f7a24', '#79c24f'],
      gold: ['#f5c542', '#e0ad24', '#ffd86b', '#c48f12', '#fff0a8'],
      ice: ['#a9d8f5', '#8cc6ec', '#c6e8fb', '#6fb0de', '#e2f5ff'],
      lava: ['#ff6a00', '#e04b00', '#ff9a1f', '#a82800', '#ffd04a'],
      crystal: ['#b56bff', '#9a4dee', '#cf9bff', '#7a2fd0', '#ecd6ff']
    };
    const LOOK = {
      blocks: { a: '#ffffff', b: '#202020' }, arcade: { a: '#ff2bd6', b: '#22e6ff' }, cyber: { a: '#22e6ff', b: '#ff2bd6' },
      rpg: { a: '#e8b84a', b: '#5b4a3a' }, scifi: { a: '#4cf2ff', b: '#0b3a4a' }, racing: { a: '#e11d48', b: '#111111' }
    };
    const accent = () => (d && d.color) || (d && d.style === 'blocks' ? MAT[d.material || 'stone'][2] : LOOK[(d && d.style) || 'blocks'].a);
    const geo = () => {
      const t = Math.max(6, Math.min(120, Number(d.thickness) || 28));
      return { X: Number(d.x) || 0, Y: Number(d.y) || 0, W: Math.max(40, Number(d.w) || 600), H: Math.max(40, Number(d.h) || 400), t };
    };
    const fontOf = (heading) => { const cs = getComputedStyle(document.documentElement); return cs.getPropertyValue(heading ? '--font-heading' : '--font').trim() || 'sans-serif'; };

    // Pixel-Schrift: klein zeichnen, Kanten hart machen, groß skalieren
    const pixCache = new Map();
    const pixelText = (ctx, text, px, py, size, color, align, outline) => {
      const k = text + '|' + color + '|' + (outline || '');
      let c = pixCache.get(k);
      if (!c) {
        c = document.createElement('canvas');
        const cx = c.getContext('2d'); cx.font = '700 9px monospace';
        const w = Math.ceil(cx.measureText(text).width) + 4; c.width = w; c.height = 13;
        cx.font = '700 9px monospace'; cx.textBaseline = 'top';
        if (outline) { cx.fillStyle = outline; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) cx.fillText(text, 2 + dx, 2 + dy); }
        cx.fillStyle = color; cx.fillText(text, 2, 2);
        const im = cx.getImageData(0, 0, c.width, c.height);
        for (let i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] > 110 ? 255 : 0;
        cx.putImageData(im, 0, 0);
        if (pixCache.size > 60) pixCache.clear();
        pixCache.set(k, c);
      }
      const sc = size / 9;
      const w = c.width * sc, h = c.height * sc;
      const ox = align === 'center' ? px - w / 2 : align === 'right' ? px - w : px;
      ctx.imageSmoothingEnabled = false; ctx.drawImage(c, ox, py - h / 2, w, h); ctx.imageSmoothingEnabled = true;
      return w;
    };
    const smoothText = (ctx, text, px, py, size, color, align, glow) => {
      ctx.save(); ctx.font = `800 ${size}px ${fontOf(true)}`; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * 0.6; }
      ctx.fillStyle = color; ctx.fillText(text, px, py);
      const w = ctx.measureText(text).width; ctx.restore(); return w;
    };
    const isPixel = () => d.style === 'blocks' || d.style === 'arcade';

    /* ---------- Rahmen zeichnen (statisch, nur bei Änderungen) ---------- */
    const drawBlocks = (c, X, Y, W, H, t) => {
      const cols = MAT[d.material || 'stone'] || MAT.stone;
      const B = t, n = 8, p = B / n;
      seed = 7;
      const block = (bx, by) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          let col = cols[(srnd() * cols.length) | 0];
          if (i === 0 || j === 0) col = cols[4]; else if (i === n - 1 || j === n - 1) col = cols[3];
          c.fillStyle = col; c.fillRect(Math.floor(bx + i * p), Math.floor(by + j * p), Math.ceil(p), Math.ceil(p));
        }
      };
      const cnt = (len) => Math.max(1, Math.round(len / B));
      const nx = cnt(W + 2 * B), ny = cnt(H);
      const bw = (W + 2 * B) / nx, bh = H / ny;
      for (let i = 0; i < nx; i++) { block(X - B + i * bw, Y - B); block(X - B + i * bw, Y + H); }
      for (let j = 0; j < ny; j++) { block(X - B, Y + j * bh); block(X + W, Y + j * bh); }
      c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = Math.max(2, p); c.strokeRect(X - B, Y - B, W + 2 * B, H + 2 * B); c.strokeRect(X, Y, W, H);
    };
    const neonRect = (c, X, Y, W, H, col, lw, blur, cut) => {
      c.save(); c.strokeStyle = col; c.lineWidth = lw; c.shadowColor = col; c.shadowBlur = blur; c.lineJoin = 'miter';
      c.beginPath();
      if (cut) { c.moveTo(X + cut, Y); c.lineTo(X + W - cut, Y); c.lineTo(X + W, Y + cut); c.lineTo(X + W, Y + H - cut); c.lineTo(X + W - cut, Y + H); c.lineTo(X + cut, Y + H); c.lineTo(X, Y + H - cut); c.lineTo(X, Y + cut); c.closePath(); }
      else c.rect(X, Y, W, H);
      c.stroke(); c.stroke(); c.restore();
    };
    const drawArcade = (c, X, Y, W, H, t) => {
      const A = accent(), Bc = LOOK.arcade.b;
      c.fillStyle = '#0a0418'; c.fillRect(X - t, Y - t, W + 2 * t, t); c.fillRect(X - t, Y + H, W + 2 * t, t); c.fillRect(X - t, Y, t, H); c.fillRect(X + W, Y, t, H);
      c.fillStyle = 'rgba(255,255,255,.06)'; for (let yy = Y - t; yy < Y + H + t; yy += 4) { c.fillRect(X - t, yy, t, 2); c.fillRect(X + W, yy, t, 2); }
      neonRect(c, X - t + 3, Y - t + 3, W + 2 * t - 6, H + 2 * t - 6, A, 4, 18);
      neonRect(c, X - 3, Y - 3, W + 6, H + 6, Bc, 3, 14);
      const s = Math.max(6, t / 3); c.fillStyle = Bc;
      for (const [cx, cy] of [[X - t, Y - t], [X + W + t - s, Y - t], [X - t, Y + H + t - s], [X + W + t - s, Y + H + t - s]]) c.fillRect(cx, cy, s, s);
    };
    const drawCyber = (c, X, Y, W, H, t) => {
      const A = accent(), Bc = LOOK.cyber.b, cut = t * 1.6;
      c.save(); c.fillStyle = 'rgba(5,8,20,.82)';
      c.beginPath(); c.moveTo(X - t + cut, Y - t); c.lineTo(X + W + t - cut, Y - t); c.lineTo(X + W + t, Y - t + cut); c.lineTo(X + W + t, Y + H + t - cut); c.lineTo(X + W + t - cut, Y + H + t); c.lineTo(X - t + cut, Y + H + t); c.lineTo(X - t, Y + H + t - cut); c.lineTo(X - t, Y - t + cut); c.closePath();
      c.rect(X + W, Y, -W, H); c.fill('evenodd'); c.restore();
      neonRect(c, X - t, Y - t, W + 2 * t, H + 2 * t, A, 3, 20, cut);
      neonRect(c, X - 2, Y - 2, W + 4, H + 4, Bc, 2, 10);
      c.fillStyle = A; for (let i = 0; i < 12; i++) c.fillRect(X + W * 0.55 + i * 10, Y - t + 6, 5, Math.max(3, t * 0.25));
      c.fillStyle = Bc; for (let i = 0; i < 6; i++) c.fillRect(X - t + 6, Y + H * 0.3 + i * 12, Math.max(3, t * 0.35), 6);
    };
    const drawRpg = (c, X, Y, W, H, t) => {
      const A = accent();
      const g = c.createLinearGradient(0, Y - t, 0, Y + H + t); g.addColorStop(0, '#6d5f52'); g.addColorStop(0.5, '#4a3f35'); g.addColorStop(1, '#3a3029');
      c.fillStyle = g; c.fillRect(X - t, Y - t, W + 2 * t, t); c.fillRect(X - t, Y + H, W + 2 * t, t); c.fillRect(X - t, Y, t, H); c.fillRect(X + W, Y, t, H);
      seed = 11; c.fillStyle = 'rgba(0,0,0,.25)';
      for (let i = 0; i < (W + H) / 6; i++) { const side = srnd(); const px = side < 0.5 ? X - t + srnd() * (W + 2 * t) : (srnd() < 0.5 ? X - t : X + W) + srnd() * t; const py = side < 0.5 ? (srnd() < 0.5 ? Y - t : Y + H) + srnd() * t : Y + srnd() * H; c.fillRect(px, py, 3 + srnd() * 6, 2); }
      c.strokeStyle = A; c.lineWidth = Math.max(2, t * 0.14); c.strokeRect(X - t * 0.45, Y - t * 0.45, W + t * 0.9, H + t * 0.9);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 2; c.strokeRect(X - t, Y - t, W + 2 * t, H + 2 * t); c.strokeRect(X, Y, W, H);
      const r = Math.max(6, t * 0.55);
      for (const [cx, cy] of [[X - t / 2, Y - t / 2], [X + W + t / 2, Y - t / 2], [X - t / 2, Y + H + t / 2], [X + W + t / 2, Y + H + t / 2]]) {
        c.save(); c.translate(cx, cy); c.rotate(Math.PI / 4); c.fillStyle = A; c.fillRect(-r, -r, 2 * r, 2 * r); c.fillStyle = '#c0182f'; c.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1); c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(-r * 0.45, -r * 0.45, r * 0.4, r * 0.4); c.restore();
      }
    };
    const drawScifi = (c, X, Y, W, H, t) => {
      const A = accent(), L = Math.min(W, H) * 0.22, lw = Math.max(3, t * 0.22);
      c.save(); c.strokeStyle = A; c.lineWidth = lw; c.shadowColor = A; c.shadowBlur = 16; c.lineCap = 'square';
      const o = t * 0.5;
      for (const [cx, cy, sx, sy] of [[X - o, Y - o, 1, 1], [X + W + o, Y - o, -1, 1], [X - o, Y + H + o, 1, -1], [X + W + o, Y + H + o, -1, -1]]) {
        c.beginPath(); c.moveTo(cx, cy + sy * L); c.lineTo(cx, cy); c.lineTo(cx + sx * L, cy); c.stroke();
      }
      c.globalAlpha = 0.45; c.lineWidth = 1.5; c.strokeRect(X, Y, W, H);
      c.globalAlpha = 0.8; c.fillStyle = A; c.shadowBlur = 0;
      for (let i = 0; i < 9; i++) c.fillRect(X + W / 2 - 60 + i * 14, Y + H + o - 2, 8, 4);
      c.restore();
      c.save(); c.font = `600 ${Math.max(10, t * 0.5)}px monospace`; c.fillStyle = A; c.globalAlpha = 0.8; c.textBaseline = 'middle';
      c.fillText('REC ● ' + new Date().getFullYear(), X + W - L + 4, Y + H + o + Math.max(10, t * 0.5)); c.restore();
    };
    const drawRacing = (c, X, Y, W, H, t) => {
      const sq = t / 2, A = accent();
      const band = (bx, by, bw, bh) => {
        c.save(); c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
        for (let i = 0; bx + i * sq < bx + bw; i++) for (let j = 0; by + j * sq < by + bh; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#f5f5f5'; c.fillRect(bx + i * sq, by + j * sq, sq, sq); }
        c.restore();
      };
      band(X - t, Y - t, W + 2 * t, t); band(X - t, Y + H, W + 2 * t, t); band(X - t, Y, t, H); band(X + W, Y, t, H);
      c.strokeStyle = A; c.lineWidth = Math.max(4, t * 0.25); c.strokeRect(X - c.lineWidth / 2, Y - c.lineWidth / 2, W + c.lineWidth, H + c.lineWidth);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 2; c.strokeRect(X - t, Y - t, W + 2 * t, H + 2 * t);
    };
    const bar = (c, bx, by, bw, bh, val, col, bg, pixel) => {
      c.fillStyle = bg; c.fillRect(bx, by, bw, bh);
      c.fillStyle = col; c.fillRect(bx + 2, by + 2, Math.max(0, (bw - 4) * Math.max(0, Math.min(100, val)) / 100), bh - 4);
      if (pixel) { c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(bx + 2, by + 2, Math.max(0, (bw - 4) * Math.max(0, Math.min(100, val)) / 100), Math.max(2, (bh - 4) / 3)); }
      c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    };
    const drawLabel = (c, X, Y, W, H, t) => {
      const text = ctxRef ? ctxRef.sub(d.label || '') : (d.label || '');
      const pos = d.labelPos || 'top-left';
      const showBars = !!d.showBars;
      if ((!text || pos === 'none') && !showBars) return;
      const size = Math.max(18, Math.min(46, t * 1.1));
      const top = pos.startsWith('top') || pos === 'none';
      const cy = top ? Y - t - size * 0.95 : Y + H + t + size * 0.95;
      const A = accent();
      let tagW = 0;
      if (text && pos !== 'none') {
        const padX = size * 0.6, h = size * 1.5;
        c.save(); c.font = `800 ${size}px ${fontOf(true)}`; const tw = isPixel() ? (c.measureText(text).width * 1.25) : c.measureText(text).width; c.restore();
        tagW = tw + padX * 2;
        const tx = pos.endsWith('center') ? X + W / 2 - tagW / 2 : X - t;
        const ty = cy - h / 2;
        if (d.style === 'blocks') { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(tx, ty, tagW, h); pixelText(c, text, tx + tagW / 2, cy, size, '#ffffff', 'center', '#3f3f3f'); }
        else if (d.style === 'arcade') { c.fillStyle = '#0a0418'; c.fillRect(tx, ty, tagW, h); neonRect(c, tx, ty, tagW, h, A, 3, 12); pixelText(c, text, tx + tagW / 2, cy, size, '#ffffff', 'center'); }
        else if (d.style === 'cyber') { c.fillStyle = 'rgba(5,8,20,.85)'; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + tagW, ty); c.lineTo(tx + tagW - h * 0.4, ty + h); c.lineTo(tx, ty + h); c.closePath(); c.fill(); c.strokeStyle = A; c.lineWidth = 2; c.stroke(); smoothText(c, text.toUpperCase(), tx + padX * 0.7, cy, size * 0.9, '#fff', 'left', A); }
        else if (d.style === 'rpg') { c.fillStyle = '#2b2119'; c.fillRect(tx, ty, tagW, h); c.strokeStyle = A; c.lineWidth = 3; c.strokeRect(tx + 3, ty + 3, tagW - 6, h - 6); smoothText(c, text, tx + tagW / 2, cy, size * 0.9, '#f8e7c0', 'center'); }
        else if (d.style === 'scifi') { c.fillStyle = 'rgba(4,20,28,.75)'; c.fillRect(tx, ty, tagW, h); c.fillStyle = A; c.fillRect(tx, ty, 5, h); smoothText(c, text.toUpperCase(), tx + padX, cy, size * 0.85, A, 'left', A); }
        else { c.fillStyle = A; c.fillRect(tx, ty, tagW, h); c.fillStyle = '#111'; c.fillRect(tx + tagW - 8, ty, 8, h); smoothText(c, text.toUpperCase(), tx + padX * 0.8, cy, size * 0.9, '#fff', 'left'); }
      }
      if (showBars) {
        const bw = Math.min(W * 0.42, 320), bh = Math.max(12, size * 0.5);
        const bx = text && pos !== 'none' && !pos.endsWith('center') ? X - t + tagW + 14 : X + W + t - bw;
        const by = cy - bh - 2;
        const pixel = isPixel();
        bar(c, bx, by, bw, bh, Number(d.hp), '#e5283c', 'rgba(0,0,0,.65)', pixel);
        bar(c, bx, by + bh + 4, bw * 0.8, bh * 0.8, Number(d.mp), '#2f7bff', 'rgba(0,0,0,.65)', pixel);
      }
    };
    const render = () => {
      const { X, Y, W, H, t } = geo();
      lx.clearRect(0, 0, 1920, 1080);
      if (d.showArea) { lx.fillStyle = 'rgba(0,200,255,.18)'; lx.fillRect(X, Y, W, H); lx.strokeStyle = '#00c8ff'; lx.setLineDash([12, 8]); lx.lineWidth = 2; lx.strokeRect(X, Y, W, H); lx.setLineDash([]); }
      ({ blocks: drawBlocks, arcade: drawArcade, cyber: drawCyber, rpg: drawRpg, scifi: drawScifi, racing: drawRacing }[d.style] || drawBlocks)(lx, X, Y, W, H, t);
      drawLabel(lx, X, Y, W, H, t);
    };

    /* ---------- Geräusche ---------- */
    const audio = () => { if (!d || !d.sound || !ctxRef || !ctxRef.audio) return null; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); return ac; } catch (_) { return null; } };
    const tone = (a, type, f0, f1, dur, vol, delay) => {
      const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    };
    const noise = (a, dur, vol, lp) => {
      const n = a.sampleRate * dur, b = a.createBuffer(1, n, a.sampleRate), ch = b.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp || 1200; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(a.destination); s.start();
    };
    const sfx = (kind) => {
      const a = audio(); if (!a) return;
      try {
        if (kind === 'explode') { noise(a, 1.1, 0.9, 900); tone(a, 'sine', 120, 35, 0.6, 0.5); }
        else if (kind === 'arrows') { for (let i = 0; i < 5; i++) { tone(a, 'triangle', 900, 300, 0.12, 0.12, i * 0.09); tone(a, 'square', 140, 80, 0.06, 0.15, i * 0.09 + 0.12); } }
        else if (kind === 'teleport') { tone(a, 'sine', 200, 1600, 0.5, 0.25); tone(a, 'triangle', 1600, 300, 0.4, 0.15, 0.45); }
        else if (kind === 'damage') { tone(a, 'square', 220, 80, 0.25, 0.25); noise(a, 0.2, 0.4, 2000); }
        else if (kind === 'heal') { [523, 659, 784, 1047].forEach((f, i) => tone(a, 'sine', f, f, 0.25, 0.18, i * 0.08)); }
        else if (kind === 'levelup') { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, 'square', f, f, 0.14, 0.12, i * 0.1)); tone(a, 'square', 1568, 1568, 0.5, 0.12, 0.55); }
        else if (kind === 'coins') { for (let i = 0; i < 6; i++) { tone(a, 'square', 988, 988, 0.06, 0.1, i * 0.12); tone(a, 'square', 1319, 1319, 0.25, 0.1, i * 0.12 + 0.06); } }
        else if (kind === 'hearts') { [784, 988, 1175].forEach((f, i) => tone(a, 'sine', f, f * 1.01, 0.3, 0.15, i * 0.12)); }
      } catch (_) {}
    };

    /* ---------- Effekte ---------- */
    const borderPoint = () => {
      const { X, Y, W, H, t } = geo(); const per = 2 * (W + H), p = Math.random() * per;
      if (p < W) return [X + p, Y - t / 2]; if (p < W + H) return [X + W + t / 2, Y + p - W];
      if (p < 2 * W + H) return [X + (p - W - H), Y + H + t / 2]; return [X - t / 2, Y + (p - 2 * W - H)];
    };
    const fire = (kind, now) => {
      const { X, Y, W, H, t } = geo(); const S = Math.max(0.2, (Number(d.fxScale) || 100) / 100), A = accent();
      sfx(kind);
      if (kind === 'explode') {
        const [ex, ey] = borderPoint();
        const cols = ['#ffffff', '#ffd23f', '#ff7a1a', '#e03b00', '#555555', '#2a2a2a'];
        for (let i = 0; i < 90 * S; i++) { const a = rnd(0, 6.28), v = rnd(150, 900) * Math.sqrt(S); parts.push({ k: 'sq', x: ex, y: ey, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, g: 900, s: rnd(6, 18) * (isPixel() ? 1.2 : 1), col: pick(cols), life: 1, dec: rnd(0.5, 0.9), r: 0, vr: isPixel() ? 0 : rnd(-6, 6) }); }
        for (let i = 0; i < 14 * S; i++) parts.push({ k: 'smoke', x: ex + rnd(-30, 30), y: ey + rnd(-30, 30), vx: rnd(-40, 40), vy: rnd(-90, -30), g: 0, s: rnd(40, 90) * S, col: 'rgba(90,90,90,', life: 1, dec: rnd(0.4, 0.7) });
        flash = { x: ex, y: ey, at: now, dur: 450, r: 260 * S, col: '255,220,150' };
        shake = { until: now + 550, amp: 16 * S };
      } else if (kind === 'arrows') {
        for (let i = 0; i < Math.round(7 * S); i++) {
          const [tx, ty] = borderPoint();
          const fromLeft = tx < X + W / 2, sx = fromLeft ? rnd(-300, -100) : rnd(2020, 2200), sy = ty + rnd(-260, 120);
          parts.push({ k: 'arrow', sx, sy, tx, ty, x: sx, y: sy, delay: i * 0.12, t: 0, fly: rnd(0.28, 0.4), life: 1, stuck: 0, ang: Math.atan2(ty - sy, tx - sx) });
        }
      } else if (kind === 'teleport') {
        const cols = ['#b56bff', '#d9a6ff', '#7a2fd0', '#ffffff', '#e25cff'];
        for (let i = 0; i < 160 * S; i++) { const [px, py] = borderPoint(); parts.push({ k: 'sq', x: px, y: py, vx: rnd(-40, 40), vy: rnd(-160, -40), g: -60, s: rnd(4, 10), col: pick(cols), life: 1, dec: rnd(0.5, 1.1), swirl: rnd(2, 5), ph: rnd(0, 6.28), r: 0, vr: 0 }); }
        flash = { x: X + W / 2, y: Y + H / 2, at: now, dur: 380, r: Math.max(W, H) * 0.8, col: '200,140,255' };
        glitchUntil = now + 700;
      } else if (kind === 'damage') {
        flash = { frame: true, at: now, dur: 650, col: '230,30,50' };
        shake = { until: now + 400, amp: 11 * S };
        texts.push({ text: '-' + ((d.fx && d.fx.amount) || 10), x: X + W * rnd(0.3, 0.7), y: Y + H * 0.4, at: now, dur: 1200, col: '#ff3b4e', size: 56 * Math.sqrt(S), vy: -70 });
      } else if (kind === 'heal') {
        for (let i = 0; i < 40 * S; i++) parts.push({ k: 'plus', x: X + rnd(0, W), y: Y + H + rnd(-20, 20), vx: rnd(-15, 15), vy: rnd(-200, -90), g: 0, s: rnd(10, 22), col: pick(['#3ddc84', '#9cf5c0', '#ffffff']), life: 1, dec: rnd(0.45, 0.8) });
        flash = { frame: true, at: now, dur: 700, col: '61,220,132' };
      } else if (kind === 'levelup') {
        texts.push({ text: 'LEVEL UP!', x: X + W / 2, y: Y + H * 0.42, at: now, dur: 2600, col: '#ffd23f', size: Math.min(110, W / 6) * Math.sqrt(S), vy: -18, pop: true, outline: '#7a4b00' });
        for (let i = 0; i < 70 * S; i++) parts.push({ k: 'star', x: X + rnd(0, W), y: Y + H + rnd(-10, 30), vx: rnd(-30, 30), vy: rnd(-420, -160), g: 120, s: rnd(8, 18), col: pick(['#ffd23f', '#fff3b0', '#ffffff', A]), life: 1, dec: rnd(0.4, 0.7), r: rnd(0, 6), vr: rnd(-4, 4) });
      } else if (kind === 'coins') {
        for (let i = 0; i < 34 * S; i++) parts.push({ k: 'coin', x: X + W / 2 + rnd(-W * 0.3, W * 0.3), y: Y + H + t / 2, vx: rnd(-320, 320), vy: rnd(-900, -500), g: 1500, s: rnd(14, 22), life: 1, dec: 0.45, ph: rnd(0, 6.28), sp: rnd(8, 16) });
      } else if (kind === 'hearts') {
        for (let i = 0; i < 26 * S; i++) parts.push({ k: 'heart', x: X + rnd(0, W), y: Y + H + rnd(0, 40), vx: 0, vy: rnd(-170, -90), g: 0, s: rnd(16, 34), col: pick(['#ff3b6b', '#ff7aa2', '#ff1f4b']), life: 1, dec: rnd(0.3, 0.55), ph: rnd(0, 6.28), delay: rnd(0, 0.8) });
      }
    };

    const drawHeart = (c, s) => { c.beginPath(); c.moveTo(0, s * 0.35); c.bezierCurveTo(-s, -s * 0.3, -s * 0.45, -s, 0, -s * 0.45); c.bezierCurveTo(s * 0.45, -s, s, -s * 0.3, 0, s * 0.35); c.fill(); };
    const drawStar = (c, s) => { c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.42 : s, a = i * Math.PI / 5 - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); };
    const drawArrow = (c, p) => {
      c.save(); c.translate(p.x, p.y); c.rotate(p.ang);
      const k = Math.max(1, geo().t / 22); c.scale(k, k);
      const L = 70, px = isPixel();
      c.fillStyle = '#8a5a2e'; c.fillRect(-L, -2.5, L - 10, 5);
      c.fillStyle = '#cfcfcf'; c.beginPath(); c.moveTo(4, 0); c.lineTo(-12, -9); c.lineTo(-12, 9); c.closePath(); c.fill();
      c.fillStyle = '#ffffff'; if (px) { c.fillRect(-L - 6, -8, 12, 5); c.fillRect(-L - 6, 3, 12, 5); } else { c.beginPath(); c.moveTo(-L + 10, 0); c.lineTo(-L - 8, -10); c.lineTo(-L - 2, 0); c.lineTo(-L - 8, 10); c.closePath(); c.fill(); }
      c.restore();
    };

    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data; ctxRef = c;
        const k = JSON.stringify([d.style, d.material, d.color, d.x, d.y, d.w, d.h, d.thickness, d.label && c.sub(d.label), d.labelPos, d.showBars, d.hp, d.mp, d.showArea]);
        if (k !== key) { key = k; render(); }
        const fx = d.fx;
        if (fxSeen === null) fxSeen = fx ? fx.id : '';          // beim Einblenden alte Effekte nicht nachholen
        else if (fx && fx.id !== fxSeen) { fxSeen = fx.id; fire(fx.kind, c.now()); }
      },
      tick(now) {
        if (!d) return;
        if (!t0) t0 = now;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
        const { X, Y, W, H, t } = geo(); const A = accent();
        x.clearRect(0, 0, 1920, 1080);
        let sx = 0, sy = 0;
        if (now < shake.until) { const k = (shake.until - now) / 500; sx = rnd(-1, 1) * shake.amp * k; sy = rnd(-1, 1) * shake.amp * k; }
        x.save(); x.translate(sx, sy);
        if (now < glitchUntil) {
          for (let yy = 0; yy < 1080; yy += 24) { const off = Math.random() < 0.35 ? rnd(-30, 30) : 0; x.drawImage(layer, 0, yy, 1920, 24, off, yy, 1920, 24); }
        } else x.drawImage(layer, 0, 0);
        // Dauer-Animation je Look
        if (d.ambient !== false) {
          const tt = (now - t0) / 1000;
          if (d.style === 'cyber' || d.style === 'arcade') {
            const per = 2 * (W + H + 4 * t), pos = (tt * 380) % per, seg = 140;
            x.save(); x.strokeStyle = '#fff'; x.shadowColor = A; x.shadowBlur = 18; x.lineWidth = 4; x.globalAlpha = 0.9;
            const pt = (p) => { const w2 = W + 2 * t, h2 = H + 2 * t; p = ((p % per) + per) % per; if (p < w2) return [X - t + p, Y - t]; p -= w2; if (p < h2) return [X + W + t, Y - t + p]; p -= h2; if (p < w2) return [X + W + t - p, Y + H + t]; p -= w2; return [X - t, Y + H + t - p]; };
            x.beginPath(); for (let i = 0; i <= 12; i++) { const [px, py] = pt(pos + i * seg / 12); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); x.restore();
          } else if (d.style === 'scifi') {
            const yy = Y + ((tt * 0.35) % 1) * H;
            const gr = x.createLinearGradient(0, yy - 30, 0, yy); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, A);
            x.save(); x.globalAlpha = 0.28; x.fillStyle = gr; x.fillRect(X, yy - 30, W, 30); x.globalAlpha = 0.7; x.fillStyle = A; x.fillRect(X, yy, W, 1.5); x.restore();
          } else if (d.style === 'rpg') {
            const a = 0.35 + 0.35 * Math.sin(tt * 2.4);
            x.save(); x.globalAlpha = a; x.fillStyle = '#ff5a6e'; x.shadowColor = '#ff2a44'; x.shadowBlur = 22;
            const r = Math.max(4, t * 0.25);
            for (const [cx, cy] of [[X - t / 2, Y - t / 2], [X + W + t / 2, Y - t / 2], [X - t / 2, Y + H + t / 2], [X + W + t / 2, Y + H + t / 2]]) { x.beginPath(); x.arc(cx, cy, r, 0, 6.3); x.fill(); }
            x.restore();
          } else if (d.style === 'blocks' && (d.material === 'lava' || d.material === 'crystal' || d.material === 'gold' || d.material === 'ice')) {
            if (Math.random() < 0.25) { const [px, py] = borderPoint(); parts.push({ k: 'sq', x: px, y: py, vx: rnd(-10, 10), vy: rnd(-60, -20), g: 0, s: rnd(3, 6), col: d.material === 'lava' ? pick(['#ffd04a', '#ff6a00']) : '#ffffff', life: 1, dec: rnd(0.8, 1.4), r: 0, vr: 0 }); }
          } else if (d.style === 'racing') {
            const pos = ((now - t0) / 1000 * 600) % (W + 2 * t);
            x.save(); x.globalAlpha = 0.35; x.fillStyle = '#fff'; x.fillRect(X - t + pos, Y - t, 40, t); x.fillRect(X + W + t - pos - 40, Y + H, 40, t); x.restore();
          }
        }
        // Blitz
        if (flash) {
          const p = (now - flash.at) / flash.dur;
          if (p >= 1) flash = null;
          else if (flash.frame) {
            const a = (1 - p) * 0.75, gw = Math.min(W, H) * 0.35;
            x.save(); x.globalAlpha = a; x.strokeStyle = `rgb(${flash.col})`; x.shadowColor = `rgb(${flash.col})`; x.shadowBlur = 40; x.lineWidth = t + 8;
            x.strokeRect(X - t / 2, Y - t / 2, W + t, H + t);
            const sides = [[X, Y, W, gw, 0, 1], [X, Y + H - gw, W, gw, 0, -1], [X, Y, gw, H, 1, 0], [X + W - gw, Y, gw, H, -1, 0]];
            for (const [rx, ry, rw, rh, dx, dy] of sides) {
              const gr = dy ? x.createLinearGradient(0, dy > 0 ? ry : ry + rh, 0, dy > 0 ? ry + rh : ry) : x.createLinearGradient(dx > 0 ? rx : rx + rw, 0, dx > 0 ? rx + rw : rx, 0);
              gr.addColorStop(0, `rgba(${flash.col},0.55)`); gr.addColorStop(1, `rgba(${flash.col},0)`); x.fillStyle = gr; x.shadowBlur = 0; x.fillRect(rx, ry, rw, rh);
            }
            x.restore();
          } else {
            const r = flash.r * (0.3 + p), gr = x.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, r);
            gr.addColorStop(0, `rgba(${flash.col},${0.9 * (1 - p)})`); gr.addColorStop(1, `rgba(${flash.col},0)`);
            x.fillStyle = gr; x.beginPath(); x.arc(flash.x, flash.y, r, 0, 6.3); x.fill();
          }
        }
        // Partikel
        parts = parts.filter((p) => {
          if (p.delay > 0) { p.delay -= dt; return true; }
          if (p.k === 'arrow') {
            if (!p.stuck) {
              p.t += dt / p.fly; const q = Math.min(1, p.t);
              p.x = p.sx + (p.tx - p.sx) * q; p.y = p.sy + (p.ty - p.sy) * q - Math.sin(q * Math.PI) * 40;
              if (q >= 1) { p.stuck = 1; p.wob = 1; }
            } else { p.life -= dt / 4; p.wob = Math.max(0, p.wob - dt * 3); }
            x.save(); x.globalAlpha = Math.min(1, p.life * 3); x.translate(p.x, p.y); x.rotate(p.stuck ? Math.sin((1 - p.wob) * 30) * 0.08 * p.wob : 0); x.translate(-p.x, -p.y); drawArrow(x, p); x.restore();
            return p.life > 0;
          }
          p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * p.dec;
          if (p.swirl) p.x += Math.sin(now / 200 * p.swirl + p.ph) * 1.5;
          if (p.r !== undefined && p.vr) p.r += p.vr * dt;
          x.save(); x.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4)); x.translate(p.x, p.y);
          if (p.k === 'sq') { x.rotate(p.r || 0); x.fillStyle = p.col; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); }
          else if (p.k === 'smoke') { x.fillStyle = p.col + (0.35 * p.life) + ')'; x.beginPath(); x.arc(0, 0, p.s * (1.6 - p.life * 0.6), 0, 6.3); x.fill(); }
          else if (p.k === 'plus') { x.fillStyle = p.col; const a = p.s, b = p.s / 3; x.fillRect(-a / 2, -b / 2, a, b); x.fillRect(-b / 2, -a / 2, b, a); }
          else if (p.k === 'star') { x.rotate(p.r || 0); x.fillStyle = p.col; drawStar(x, p.s); }
          else if (p.k === 'heart') { x.translate(Math.sin(now / 300 + p.ph) * 12, 0); x.fillStyle = p.col; drawHeart(x, p.s); }
          else if (p.k === 'coin') {
            const sxs = Math.cos(now / 1000 * p.sp + p.ph);
            x.scale(Math.max(0.12, Math.abs(sxs)), 1); x.fillStyle = '#c48f12'; x.beginPath(); x.arc(0, 0, p.s, 0, 6.3); x.fill();
            x.fillStyle = sxs > 0 ? '#ffd23f' : '#f0b42a'; x.beginPath(); x.arc(0, 0, p.s * 0.8, 0, 6.3); x.fill(); x.fillStyle = '#fff3b0'; x.fillRect(-p.s * 0.15, -p.s * 0.5, p.s * 0.3, p.s);
          }
          x.restore();
          return p.life > 0 && p.y < 1200 && p.y > -200;
        });
        // Texte
        texts = texts.filter((tx) => {
          const p = (now - tx.at) / tx.dur; if (p >= 1) return false;
          const sc = tx.pop ? (p < 0.15 ? 0.4 + p / 0.15 * 0.8 : p < 0.25 ? 1.2 - (p - 0.15) / 0.1 * 0.2 : 1) : 1;
          x.save(); x.globalAlpha = p > 0.75 ? (1 - p) / 0.25 : 1; x.translate(tx.x, tx.y + tx.vy * p * tx.dur / 1000); x.scale(sc, sc);
          if (isPixel()) pixelText(x, tx.text, 0, 0, tx.size, tx.col, 'center', tx.outline || '#000');
          else { x.lineWidth = Math.max(4, tx.size / 10); x.strokeStyle = tx.outline || 'rgba(0,0,0,.7)'; x.font = `900 ${tx.size}px ${fontOf(true)}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.strokeText(tx.text, 0, 0); x.fillStyle = tx.col; x.fillText(tx.text, 0, 0); }
          x.restore(); return true;
        });
        x.restore();
      },
      destroy() { try { ac && ac.close(); } catch (_) {} }
    };
  };

  /* ---------------- Timer ---------------- */
  R.timer = () => {
    const el = div('tmr', '<div class="tl"></div><div class="tv"></div>');
    const tl = el.querySelector('.tl'), tv = el.querySelector('.tv');
    let d = null;
    return {
      el, needsTick: true,
      update(g, c) { d = g.data; setText(tl, c.sub(d.label)); tl.style.display = d.label ? '' : 'none'; },
      tick(now) { if (!d) return; const r = timerText(d, now); setText(tv, r.text); el.classList.toggle('over', !!r.over); }
    };
  };

  R.bigtimer = () => {
    const el = div('big', '<div class="bl"></div><div class="bv"></div><div class="prog"><i></i></div>');
    const bl = el.querySelector('.bl'), bv = el.querySelector('.bv'), prog = el.querySelector('.prog'), bar = prog.firstChild;
    let d = null;
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data;
        setText(bl, c.sub(d.label)); bl.style.display = d.label ? '' : 'none';
        prog.style.display = d.progress && d.timer.mode !== 'up' ? '' : 'none';
        el.classList.toggle('bg-theme', d.background === 'theme');
        el.classList.toggle('bg-black', d.background === 'black');
      },
      tick(now) {
        if (!d) return;
        const r = timerText(d, now);
        setText(bv, r.text);
        const s = r.ms / 1000;
        const down = d.timer.mode !== 'up';
        el.classList.toggle('over', down && !!r.over);
        el.classList.toggle('danger', down && !r.over && s <= Number(d.dangerAt) && s > 0);
        el.classList.toggle('warn', down && !r.over && s <= Number(d.warnAt) && s > Number(d.dangerAt));
        const dur = (d.timer.duration || 1) * 1000;
        bar.style.width = Math.max(0, Math.min(100, (r.ms / dur) * 100)) + '%';
      }
    };
  };

  R.speakertimer = () => {
    const el = div('spk', '<div class="top"><span class="nm"></span><span class="clk"></span></div><div class="tv"></div><div class="note"></div><div class="prog"><i></i></div>');
    const nm = el.querySelector('.nm'), clk = el.querySelector('.clk'), tv = el.querySelector('.tv'), note = el.querySelector('.note'), prog = el.querySelector('.prog'), bar = prog.firstChild;
    let d = null;
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data;
        setText(nm, c.sub(d.speaker));
        const n = c.sub(d.note);
        setText(note, n); note.style.display = n ? '' : 'none';
        note.classList.toggle('flash', !!d.flashNote);
        prog.style.display = d.progress ? '' : 'none';
        clk.style.display = d.showClock ? '' : 'none';
      },
      tick(now) {
        if (!d) return;
        const r = timerText(Object.assign({}, d, { allowOverrun: true }), now);
        setText(tv, r.text);
        const s = r.ms / 1000;
        const down = d.timer.mode !== 'up';
        el.classList.toggle('over', down && r.ms < 0);
        el.classList.toggle('danger', down && r.ms >= 0 && s <= Number(d.dangerAt));
        el.classList.toggle('warn', down && r.ms >= 0 && s <= Number(d.warnAt) && s > Number(d.dangerAt));
        bar.style.width = Math.max(0, Math.min(100, (r.ms / ((d.timer.duration || 1) * 1000)) * 100)) + '%';
        if (d.showClock) setText(clk, new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      }
    };
  };

  R.timeofday = () => {
    const el = div('tod', '<div class="tl"></div><div class="tv"></div><div class="td"></div>');
    const tl = el.querySelector('.tl'), tv = el.querySelector('.tv'), td = el.querySelector('.td');
    let d = null, fmtT = null, fmtD = null;
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data;
        el.className = 'tod' + (d.style === 'plain' ? ' plain' : d.style === 'big' ? ' big-style' : '');
        setText(tl, c.sub(d.label)); tl.style.display = d.label ? '' : 'none';
        td.style.display = d.showDate ? '' : 'none';
        const tz = d.timezone ? { timeZone: d.timezone } : {};
        try {
          fmtT = new Intl.DateTimeFormat('de-DE', Object.assign({ hour: '2-digit', minute: '2-digit', second: d.seconds ? '2-digit' : undefined, hour12: !!d.hour12 }, tz));
          fmtD = new Intl.DateTimeFormat('de-DE', Object.assign({ weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }, tz));
        } catch (_) {
          fmtT = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: d.seconds ? '2-digit' : undefined, hour12: !!d.hour12 });
          fmtD = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        }
      },
      tick(now) { if (!fmtT) return; const dt = new Date(now); setText(tv, fmtT.format(dt)); if (d.showDate) setText(td, fmtD.format(dt)); }
    };
  };

  /* ---------------- Testbild ---------------- */
  R.testpattern = () => {
    const el = div('tp');
    let d = null, info = null, osc = null, actx = null;
    const bars = (colors, top, h) => `<div class="tp-bars" style="top:${top}px;height:${h}px">${colors.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`;
    const stopTone = () => { try { osc && osc.stop(); actx && actx.close(); } catch (_) {} osc = null; actx = null; };
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data;
        let html = '';
        const p = d.pattern;
        if (p === 'smpte') {
          html = bars(['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'], 0, 720) +
            bars(['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'], 720, 90) +
            bars(['#00214c', '#ffffff', '#32006a', '#131313', '#131313', '#090909', '#131313', '#1d1d1d', '#131313'], 810, 270);
        } else if (p === 'ebu') {
          html = bars(['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'], 0, 1080);
        } else if (p === 'gradient') {
          html = '<div style="position:absolute;inset:0;background:linear-gradient(90deg,#000,#fff)"></div>' +
            bars(['#000', '#111', '#222', '#333', '#444', '#555', '#666', '#777', '#888', '#999', '#aaa', '#bbb', '#ccc', '#ddd', '#eee', '#fff'], 780, 300);
        } else if (p === 'checker') {
          el.style.background = 'transparent';
          html = '<div style="position:absolute;inset:0;background:repeating-conic-gradient(rgba(255,255,255,.9) 0 25%, rgba(0,0,0,.9) 0 50%) 0 0/120px 120px"></div>' +
            '<div style="position:absolute;left:0;right:0;bottom:0;height:200px;background:linear-gradient(90deg,rgba(255,0,0,0),rgba(255,0,0,1))"></div>' +
            '<div style="position:absolute;left:0;right:0;bottom:200px;height:120px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,1))"></div>';
        } else if (p === 'color') {
          html = `<div style="position:absolute;inset:0;background:${esc(d.color)}"></div>`;
        } else if (p === 'grid' || p === 'safe') {
          const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
          const x = cv.getContext('2d');
          x.fillStyle = p === 'grid' ? '#000' : 'rgba(0,0,0,0)'; x.fillRect(0, 0, 1920, 1080);
          if (p === 'grid') {
            x.strokeStyle = '#fff'; x.lineWidth = 2;
            for (let i = 0; i <= 1920; i += 120) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1080); x.stroke(); }
            for (let i = 0; i <= 1080; i += 120) { x.beginPath(); x.moveTo(0, i); x.lineTo(1920, i); x.stroke(); }
            x.beginPath(); x.arc(960, 540, 500, 0, Math.PI * 2); x.stroke();
            x.beginPath(); x.moveTo(0, 0); x.lineTo(1920, 1080); x.moveTo(1920, 0); x.lineTo(0, 1080); x.stroke();
          }
          x.lineWidth = 4;
          x.strokeStyle = '#ffff00'; x.strokeRect(96, 54, 1728, 972); // 90 % Action-Safe
          x.strokeStyle = '#00ffff'; x.strokeRect(192, 108, 1536, 864); // 80 % Title-Safe
          x.fillStyle = '#ffff00'; x.font = '28px sans-serif'; x.fillText('Action Safe 90 %', 110, 90);
          x.fillStyle = '#00ffff'; x.fillText('Title Safe 80 %', 206, 144);
          html = '';
          el.innerHTML = '';
          el.appendChild(cv);
        }
        el.style.background = p === 'checker' || p === 'safe' ? 'transparent' : '#000';
        if (p !== 'grid' && p !== 'safe') el.innerHTML = html;
        info = null;
        if (d.showInfo) {
          info = div('tp-info', `${esc(c.sub(d.ident))}<small></small>`);
          el.appendChild(info);
        }
        if (d.tone && c.audio && !osc) {
          try {
            actx = new AudioContext(); osc = actx.createOscillator(); const gain = actx.createGain();
            gain.gain.value = 0.125; // ca. -18 dBFS
            osc.frequency.value = 1000; osc.connect(gain).connect(actx.destination); osc.start();
          } catch (_) { osc = null; }
        } else if ((!d.tone || !c.audio) && osc) stopTone();
      },
      tick(now) { if (info) setText(info.lastChild, `${window.CUE_OUTPUT_LABEL || ''} · ${new Date(now).toLocaleTimeString('de-DE')}`); },
      destroy: stopTone
    };
  };

  /* ---------------- Abspann ---------------- */
  R.credits = () => {
    const el = div('cr', '<div class="cr-roll"></div>');
    const roll = el.firstChild;
    let d = null, h = 0, shownAt = 0, ended = false, cur = null, ctx = null;
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data; cur = g; ctx = c;
        if (g.shownAt !== shownAt) { shownAt = g.shownAt; ended = false; }
        el.className = 'cr' + (d.background === 'dim' ? ' bg-dim' : d.background === 'theme' ? ' bg-theme' : '');
        setHtml(roll, (d.heading ? `<h1>${esc(c.sub(d.heading))}</h1>` : '') + (d.entries || []).map((e) =>
          `<div class="cr-entry">${e.role ? `<div class="cr-role">${esc(c.sub(e.role))}</div>` : ''}<div class="cr-names">${nl(c.sub(e.names))}</div></div>`).join(''));
        h = roll.scrollHeight;
      },
      tick(now) {
        if (!d) return;
        const total = 1080 + h;
        let dist = ((now - shownAt) / 1000) * (Number(d.speed) || 80);
        if (d.loop) dist = dist % total;
        else if (dist > total) {
          dist = total;
          if (!ended) { ended = true; ctx.ended(cur); }
        }
        roll.style.transform = `translate3d(0,${1080 - dist}px,0)`;
      }
    };
  };

  /* ---------------- Songtexte ---------------- */
  R.lyrics = () => {
    const el = div('ly', '<div class="ly-box"><div class="ly-title"></div><div class="ly-text"></div></div>');
    const title = el.querySelector('.ly-title'), text = el.querySelector('.ly-text');
    let lastKey = null;
    return {
      el,
      update(g, c) {
        const d = g.data;
        el.className = `ly ${d.layout}${d.uppercase ? ' upper' : ''}`;
        setText(title, c.sub(d.song)); title.style.display = d.showTitle && d.song ? '' : 'none';
        const slides = String(d.text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
        const i = Math.max(0, Math.min(slides.length - 1, Number(d.index) || 0));
        const html = nl(c.sub(slides[i] || ''));
        text.style.fontSize = `calc(${Number(d.fontSize) || 54}px * var(--fs))`;
        const key = i + '|' + html;
        if (key === lastKey) return;
        if (lastKey === null) { text.innerHTML = html; lastKey = key; return; }
        lastKey = key;
        text.classList.add('swap');
        setTimeout(() => { text.innerHTML = html; text.classList.remove('swap'); }, 260);
      }
    };
  };

  /* ---------------- Jetzt / Gleich / Danach ---------------- */
  R.nnt = () => {
    const el = div('nnt');
    return {
      el,
      update(g, c) {
        const d = g.data;
        const items = d.items || [];
        const i = Math.max(0, Number(d.index) || 0);
        const labels = [d.labelNow, d.labelNext, d.labelThen];
        const n = Number(d.count) || 3;
        el.className = `nnt ${d.layout}`;
        const parts = [];
        for (let k = 0; k < n; k++) {
          const it = items[i + k];
          if (!it) continue;
          parts.push(`<div class="nnt-item${k === 0 ? ' now' : ''}"><div class="nnt-label">${esc(c.sub(labels[k]))}${it.time ? ` · <span class="nnt-time">${esc(c.sub(it.time))}</span>` : ''}</div>` +
            `<div class="nnt-title">${esc(c.sub(it.title))}</div>${it.subtitle ? `<div class="nnt-sub">${esc(c.sub(it.subtitle))}</div>` : ''}</div>`);
        }
        setHtml(el, parts.join(''));
      }
    };
  };

  /* ---------------- QR ---------------- */
  R.qr = () => {
    const el = div('qr', '<img><div class="cap"></div>');
    const img = el.querySelector('img'), cap = el.querySelector('.cap');
    return {
      el,
      update(g, c) {
        const d = g.data;
        const src = `/api/qr.svg?text=${encodeURIComponent(c.sub(d.url))}&fg=${encodeURIComponent(d.fg)}&bg=${encodeURIComponent(d.bg)}&border=2`;
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.style.width = img.style.height = (Number(d.size) || 280) + 'px';
        img.style.background = d.bg;
        setText(cap, c.sub(d.caption)); cap.style.display = d.caption ? '' : 'none';
        el.style.background = d.bg; el.style.color = d.fg;
      }
    };
  };

  /* ---------------- Feier / Konfetti ---------------- */
  R.celebration = () => {
    const el = div('');
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; cv.className = 'fx-canvas';
    el.appendChild(cv);
    const x = cv.getContext('2d');
    let parts = [], d = null, shownAt = 0, last = 0, spawned = 0, msgEl = null, palette = [], rockets = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const themeColors = () => {
      const cs = getComputedStyle(document.documentElement);
      return ['--primary', '--accent', '--secondary', '--text'].map((v) => cs.getPropertyValue(v).trim()).filter(Boolean).concat(['#ffd166', '#06d6a0', '#118ab2', '#ef476f']);
    };
    const confetti = (n, ox, oy, spread, power, angle) => {
      for (let i = 0; i < n; i++) {
        const a = (angle === undefined ? rnd(0, Math.PI * 2) : angle + rnd(-spread, spread));
        const v = rnd(power * 0.4, power);
        parts.push({ k: 'c', x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(10, 20), h: rnd(6, 12), r: rnd(0, 6.3), vr: rnd(-8, 8), col: palette[(Math.random() * palette.length) | 0], life: 1, tilt: rnd(0, 6.3) });
      }
    };
    return {
      el, needsTick: true,
      update(g, c) {
        d = g.data;
        palette = themeColors();
        if (g.shownAt !== shownAt) { shownAt = g.shownAt; parts = []; rockets = []; spawned = 0; last = 0; }
        if (msgEl) { msgEl.remove(); msgEl = null; }
        if (d.message) { msgEl = div('fx-msg', esc(c.sub(d.message))); el.appendChild(msgEl); }
      },
      tick(now) {
        if (!d) return;
        const t = (now - shownAt) / 1000;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
        last = now;
        const dur = Number(d.duration) || 6;
        const I = (Number(d.intensity) || 100) / 100;
        const emitting = t < dur * 0.8;
        if (emitting) {
          const want = Math.floor(t * 60);
          while (spawned < want) {
            spawned++;
            if (d.effect === 'confetti') { for (let i = 0; i < Math.ceil(4 * I); i++) parts.push({ k: 'c', x: rnd(0, 1920), y: -30, vx: rnd(-60, 60), vy: rnd(150, 350), w: rnd(10, 20), h: rnd(6, 12), r: rnd(0, 6.3), vr: rnd(-6, 6), col: palette[(Math.random() * palette.length) | 0], life: 1, tilt: rnd(0, 6.3) }); }
            else if (d.effect === 'emoji') { const em = [...(d.emoji || '🎉')]; if (Math.random() < 0.5 * I) parts.push({ k: 'e', x: rnd(0, 1920), y: -80, vx: rnd(-30, 30), vy: rnd(200, 420), s: rnd(50, 110), r: rnd(-0.5, 0.5), vr: rnd(-1, 1), ch: em[(Math.random() * em.length) | 0], life: 1 }); }
            else if (d.effect === 'cannons') { if (spawned % 40 === 1) { confetti(Math.round(90 * I), 0, 1080, 0.35, 1700, -Math.PI / 3); confetti(Math.round(90 * I), 1920, 1080, 0.35, 1700, -Math.PI * 2 / 3); } }
            else if (d.effect === 'fireworks') { if (Math.random() < 0.05 * I) rockets.push({ x: rnd(300, 1620), y: 1080, vy: rnd(-1100, -850), ty: rnd(150, 500), col: palette[(Math.random() * palette.length) | 0] }); }
          }
        }
        rockets = rockets.filter((r) => {
          r.y += r.vy * dt; r.vy += 500 * dt;
          if (r.y <= r.ty || r.vy >= 0) {
            for (let i = 0; i < 90; i++) { const a = rnd(0, 6.3), v = rnd(100, 520); parts.push({ k: 's', x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: r.col, life: 1 }); }
            return false;
          }
          return true;
        });
        x.clearRect(0, 0, 1920, 1080);
        for (const r of rockets) { x.fillStyle = '#fff'; x.beginPath(); x.arc(r.x, r.y, 4, 0, 6.3); x.fill(); }
        parts = parts.filter((p) => {
          if (p.k === 'c') {
            p.vy += 400 * dt; p.vx *= 0.99; p.vy = Math.min(p.vy, 420 + (p.w * 4));
            p.x += (p.vx + Math.sin(p.tilt + now / 300) * 40) * dt; p.y += p.vy * dt; p.r += p.vr * dt;
            if (t > dur * 0.8) p.life -= dt / (dur * 0.2 + 0.01);
            x.save(); x.globalAlpha = Math.max(0, p.life); x.translate(p.x, p.y); x.rotate(p.r); x.scale(1, Math.cos(p.tilt + now / 200));
            x.fillStyle = p.col; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore();
            return p.y < 1140 && p.life > 0;
          }
          if (p.k === 'e') {
            p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
            if (t > dur * 0.8) p.life -= dt / (dur * 0.2 + 0.01);
            x.save(); x.globalAlpha = Math.max(0, p.life); x.translate(p.x, p.y); x.rotate(p.r); x.font = `${p.s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; x.textAlign = 'center'; x.fillText(p.ch, 0, 0); x.restore();
            return p.y < 1200 && p.life > 0;
          }
          p.vy += 180 * dt; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.8;
          x.globalAlpha = Math.max(0, p.life); x.fillStyle = p.col; x.beginPath(); x.arc(p.x, p.y, 3.2, 0, 6.3); x.fill(); x.globalAlpha = 1;
          return p.life > 0;
        });
        if (msgEl) msgEl.style.opacity = t > dur ? Math.max(0, 1 - (t - dur) * 2) : 1;
      }
    };
  };

  /* ---------------- Animierter Hintergrund ---------------- */
  R.animbg = () => {
    const el = div('abg');
    let d = null, cv = null, x = null, pts = [], last = 0;
    const col = (v, fb) => v || `var(${fb})`;
    return {
      el, needsTick: true,
      update(g) {
        d = g.data;
        const c1 = col(d.color1, '--primary'), c2 = col(d.color2, '--accent'), c3 = col(d.color3, '--secondary');
        el.style.setProperty('--spd', Math.max(0.1, (Number(d.speed) || 100) / 100));
        el.style.opacity = (Number(d.opacity) || 0) / 100;
        el.style.background = d.base;
        el.className = 'abg ' + d.style;
        cv = null;
        if (d.style === 'blobs') el.innerHTML = `<div class="blob b1" style="background:${esc(c1)}"></div><div class="blob b2" style="background:${esc(c2)}"></div><div class="blob b3" style="background:${esc(c3)}"></div>`;
        else if (d.style === 'gradient') { el.innerHTML = ''; el.style.background = `linear-gradient(120deg, ${d.base}, ${c1}, ${c2}, ${c3}, ${d.base})`; }
        else if (d.style === 'waves') {
          const wave = (c, op, hgt, amp, dur) => `<svg class="wave" style="--wd:${dur}s;bottom:0" viewBox="0 0 3840 400" preserveAspectRatio="none" height="${hgt}"><path fill="${esc(c)}" fill-opacity="${op}" d="M0 200 ${Array.from({ length: 8 }, (_, i) => `Q ${i * 480 + 240} ${i % 2 ? 200 + amp : 200 - amp} ${(i + 1) * 480} 200`).join(' ')} V400 H0 Z"/></svg>`;
          el.innerHTML = wave(c3, 0.55, 560, 110, 30) + wave(c2, 0.45, 420, 80, 24) + wave(c1, 0.6, 300, 90, 18);
        } else if (d.style === 'grid') {
          el.innerHTML = `<div class="gridp" style="--g1:${esc(c1)}"></div><div style="position:absolute;left:0;right:0;top:0;height:60%;background:radial-gradient(ellipse at 50% 100%, ${esc(c2)} 0%, transparent 60%);opacity:.6"></div>`;
        } else if (d.style === 'particles') {
          el.innerHTML = '';
          cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; cv.className = 'fx-canvas';
          el.appendChild(cv); x = cv.getContext('2d');
          const cs = getComputedStyle(el);
          const resolve = (v) => { if (!v.startsWith('var(')) return v; return cs.getPropertyValue(v.slice(4, -1)).trim() || '#fff'; };
          const cols = [resolve(c1), resolve(c2), resolve(c3)];
          pts = Array.from({ length: 140 }, () => ({ x: Math.random() * 1920, y: Math.random() * 1080, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, r: 1 + Math.random() * 3, c: cols[(Math.random() * 3) | 0] }));
        }
      },
      tick(now) {
        if (!cv || !d) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
        const spd = Math.max(0.1, (Number(d.speed) || 100) / 100);
        x.clearRect(0, 0, 1920, 1080);
        for (const p of pts) {
          p.x = (p.x + p.vx * dt * spd + 1920) % 1920; p.y = (p.y + p.vy * dt * spd + 1080) % 1080;
          x.fillStyle = p.c; x.globalAlpha = 0.8; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.3); x.fill();
        }
        x.globalAlpha = 0.15; x.strokeStyle = pts[0] ? pts[0].c : '#fff';
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j], dx = a.x - b.x, dy = a.y - b.y;
          if (dx * dx + dy * dy < 14000) { x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
        }
        x.globalAlpha = 1;
      }
    };
  };

  /* ---------------- Umfrage ---------------- */
  const audienceUrl = (c) => (c.audienceUrl ? c.audienceUrl() : (c.publicBase ? c.publicBase() : location.origin) + '/audience');
  const qrImg = (url, cls) => `<img class="${cls || ''}" src="/api/qr.svg?text=${encodeURIComponent(url)}&border=2">`;

  R.poll = () => {
    const el = div('poll');
    return {
      el,
      depKey: (g, project) => JSON.stringify((project.polls || []).find((p) => p.id === g.data.pollId) || (project.polls || [])[0] || null),
      update(g, c) {
        const d = g.data;
        el.style.width = (Number(d.width) || 820) + 'px';
        const poll = (c.project.polls || []).find((p) => p.id === d.pollId) || (c.project.polls || [])[0];
        if (!poll) { el._sig = ''; setHtml(el, '<h3>Keine Umfrage ausgewählt</h3>'); return; }
        const type = poll.type || 'choice';
        const voteUrl = audienceUrl(c);
        let total = 0;
        if (type === 'rating') total = (poll.ratings || []).reduce((s, n) => s + n, 0);
        else if (type === 'wordcloud') total = Object.values(poll.words || {}).reduce((s, w) => s + w.count, 0);
        else total = poll.options.reduce((s, o) => s + o.votes, 0);
        // Mehrfachauswahl: Prozent bezogen auf Teilnehmende (wie bei Slido)
        const base = type === 'multi' ? Math.max(1, poll.respondents || 0) : total;
        const waiting = total < (Number(d.hideUntilVotes) || 0);
        const sig = poll.id + type + (type === 'choice' || type === 'multi' ? poll.options.map((o) => o.id + o.text).join('|') : poll.scale) + d.showQr + waiting + voteUrl;
        if (el._sig !== sig) {
          el._sig = sig;
          let body = '';
          if (waiting) body = '<div class="poll-wait"><div class="dots"><i></i><i></i><i></i></div><span>Abstimmung läuft …</span></div>';
          else if (type === 'rating') body = `<div class="rate"><div class="rate-avg"><b></b><span class="stars"></span></div><div class="rate-bars">${Array.from({ length: poll.scale }, (_, i) => `<div class="row" data-r="${poll.scale - i}"><div class="fill" style="width:0"></div><div class="lbl"><span>${poll.scale - i} ★</span><span class="v"></span></div></div>`).join('')}</div></div>`;
          else if (type === 'wordcloud') body = '<div class="cloud"></div>';
          else body = poll.options.map((o) => `<div class="row" data-o="${esc(o.id)}"><div class="fill" style="width:0"></div><div class="lbl"><span>${esc(o.text)}</span><span class="v"></span></div></div>`).join('');
          el.className = 'poll poll-' + type;
          el.innerHTML = `<h3></h3>${body}<div class="meta"><span class="tot"></span>${d.showQr ? qrImg(voteUrl) : ''}</div>`;
        }
        setText(el.querySelector('h3'), poll.question);
        const nResp = poll.respondents || 0;
        setText(el.querySelector('.tot'), !d.showVotes ? '' : type === 'wordcloud' ? `${total} Begriff${total === 1 ? '' : 'e'} · ${nResp} Teilnehmende` : type === 'multi' ? `${nResp} Teilnehmende` : `${total} Stimme${total === 1 ? '' : 'n'}`);
        if (waiting) return;
        if (type === 'rating') {
          const r = poll.ratings || [];
          const sum = r.reduce((s, n, i) => s + n * (i + 1), 0);
          const avg = total ? sum / total : 0;
          setText(el.querySelector('.rate-avg b'), total ? avg.toFixed(1).replace('.', ',') : '–');
          const st = el.querySelector('.stars');
          st.style.setProperty('--pct', ((avg / poll.scale) * 100).toFixed(1) + '%');
          setText(st, '★'.repeat(poll.scale));
          const max = Math.max(0, ...r);
          for (let v = 1; v <= poll.scale; v++) {
            const row = el.querySelector(`.row[data-r="${v}"]`); if (!row) continue;
            const n = r[v - 1] || 0, pct = total ? Math.round((n / total) * 100) : 0;
            row.querySelector('.fill').style.width = pct + '%';
            row.classList.toggle('lead', total > 0 && n === max);
            setText(row.querySelector('.v'), [d.showPercent ? pct + ' %' : '', d.showVotes ? `(${n})` : ''].filter(Boolean).join(' '));
          }
          return;
        }
        if (type === 'wordcloud') {
          const cloud = el.querySelector('.cloud');
          const words = Object.entries(poll.words || {}).filter(([, w]) => w.count > 0).sort((a, b) => b[1].count - a[1].count).slice(0, 50);
          const max = words.length ? words[0][1].count : 1, min = words.length ? words[words.length - 1][1].count : 1;
          const hash = (k) => { let x = 0; for (const ch of k) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; };
          // stabile, gemischte Reihenfolge; größte Begriffe in die Mitte
          const ordered = words.map(([k, w], i) => ({ k, w, i, h: hash(k) })).sort((a, b) => a.h - b.h);
          const mid = [];
          ordered.sort((a, b) => a.i - b.i).forEach((o, i) => { if (i % 2) mid.push(o); else mid.unshift(o); });
          const seen = new Set();
          mid.forEach((o, pos) => {
            seen.add(o.k);
            let w = cloud.querySelector(`[data-k="${CSS.escape(o.k)}"]`);
            if (!w) { w = document.createElement('span'); w.dataset.k = o.k; w.className = 'wc-word new'; cloud.appendChild(w); requestAnimationFrame(() => w.classList.remove('new')); }
            const t = max === min ? 1 : (o.w.count - min) / (max - min);
            w.style.fontSize = Math.round(30 + t * 90) + 'px';
            w.style.order = pos;
            w.style.color = ['var(--primary)', 'var(--text)', 'var(--accent)'][o.h % 3];
            w.style.opacity = (0.6 + t * 0.4).toFixed(2);
            setText(w, o.w.text);
            w.title = o.w.count;
          });
          for (const w of [...cloud.children]) if (!seen.has(w.dataset.k)) w.remove();
          return;
        }
        const max = Math.max(0, ...poll.options.map((o) => o.votes));
        for (const o of poll.options) {
          const row = el.querySelector(`.row[data-o="${CSS.escape(o.id)}"]`);
          if (!row) continue;
          const pct = total ? Math.round((o.votes / base) * 100) : 0;
          row.querySelector('.fill').style.width = pct + '%';
          row.classList.toggle('lead', total > 0 && o.votes === max);
          const parts = [];
          if (d.showPercent) parts.push(pct + ' %');
          if (d.showVotes) parts.push(`(${o.votes})`);
          setText(row.querySelector('.v'), parts.join(' '));
        }
      }
    };
  };

  /* ---------------- Q&A live (Fragen-Wand / einzelne Frage) ---------------- */
  R.qawall = () => {
    const el = div('qaw');
    let d = null, list = [], shownAt = 0, lastRot = -1, ctx = null, singleId = null;
    const visibleQs = (project) => (project.questions || []).filter((q) => q.status === 'live' && !q.resolved);
    const sortQs = (qs, mode) => qs.slice().sort(mode === 'newest' ? (a, b) => b.ts - a.ts : mode === 'oldest' ? (a, b) => a.ts - b.ts : (a, b) => (b.likes - a.likes) || (a.ts - b.ts));
    const likeHtml = (q) => d.showLikes ? `<div class="qaw-likes"><span class="ar">▲</span><b>${q.likes || 0}</b></div>` : '';
    const itemInner = (q) => `${likeHtml(q)}<div class="qaw-body"><div class="qaw-text">${nl(q.text)}</div>${d.showAuthor ? `<div class="qaw-author">${esc(q.author)}</div>` : ''}</div>${q.active ? '<div class="qaw-badge">Jetzt dran</div>' : ''}`;

    function renderWall(c) {
      const all = visibleQs(c.project);
      const newestAny = all.slice().sort((a, b) => b.ts - a.ts)[0] || null;
      const newest = d.showNewest ? newestAny : null;
      let rest = sortQs(all.filter((q) => q !== newest || q.active), d.sort);
      if (d.activeFirst) { const a = rest.find((q) => q.active); if (a) rest = [a].concat(rest.filter((q) => q !== a)); }
      if (newest && newest.active) { /* aktive neueste Frage steht oben in der Liste, nicht doppelt */ }
      let top = rest.slice(0, Math.max(1, Number(d.count) || 5));
      // Neueste Frage muss immer zu sehen sein – auch ohne eigene Hervorhebung
      if (!d.showNewest && newestAny && !top.includes(newestAny)) top = top.slice(0, Math.max(0, top.length - 1)).concat(newestAny);
      const showNew = newest && !top.includes(newest);
      if (!el.querySelector('.qaw-list')) {
        el.innerHTML = '<div class="qaw-main"><div class="qaw-h"><div class="qaw-ht"><span class="qaw-title"></span><span class="qaw-count"></span></div><div class="qaw-foot"></div></div><div class="qaw-list"></div><div class="qaw-new"><div class="qaw-new-label">Neueste Frage</div><div class="qaw-item"></div></div><div class="qaw-empty"></div></div><div class="qaw-side"></div>';
      }
      setText(el.querySelector('.qaw-title'), c.sub(d.heading));
      el.querySelector('.qaw-h').style.display = d.heading || (d.showQr && qrPlace() === 'header') ? '' : 'none';
      const cntEl = el.querySelector('.qaw-count');
      cntEl.dataset.base = all.length ? `${all.length} Frage${all.length === 1 ? '' : 'n'}` : '';
      setText(cntEl, cntEl.dataset.base);
      // FLIP: Positionen merken, neu ordnen, Bewegung animieren
      const box = el.querySelector('.qaw-list');
      const before = new Map([...box.children].map((n) => [n.dataset.id, n.getBoundingClientRect().top]));
      const keep = new Set(top.map((q) => q.id));
      for (const n of [...box.children]) if (!keep.has(n.dataset.id)) n.remove();
      top.forEach((q, i) => {
        let n = box.querySelector(`[data-id="${CSS.escape(q.id)}"]`);
        if (!n) { n = document.createElement('div'); n.dataset.id = q.id; n.className = 'qaw-item enter'; requestAnimationFrame(() => requestAnimationFrame(() => n.classList.remove('enter'))); }
        n.classList.toggle('active', !!q.active);
        // Aktive und neueste Frage werden beim Platzmangel nie ausgeblendet
        if (q.active || (newestAny && q.id === newestAny.id)) n.dataset.protect = '1'; else delete n.dataset.protect;
        setHtml(n, itemInner(q));
        if (box.children[i] !== n) box.insertBefore(n, box.children[i] || null);
      });
      for (const n of box.children) {
        const old = before.get(n.dataset.id);
        if (old === undefined) continue;
        const dy = old - n.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          n.style.transition = 'none'; n.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => { n.style.transition = ''; n.style.transform = ''; });
        }
      }
      const nb = el.querySelector('.qaw-new');
      nb.style.display = showNew ? '' : 'none';
      if (showNew) setHtml(nb.querySelector('.qaw-item'), itemInner(newest));
      renderQr(c);
      const empty = el.querySelector('.qaw-empty');
      setText(empty, all.length ? '' : c.sub(d.emptyText));
      empty.style.display = all.length ? 'none' : '';
      el.style.display = !all.length && !d.emptyText && !d.showQr ? 'none' : '';
      fit();
    }

    /* ---------- An die verfügbare Höhe anpassen ----------
       Überschrift, neueste Frage und QR-Code bleiben immer sichtbar. Darüber stehen nur so viele
       weitere Fragen, wie in die Höhe passen (unter Berücksichtigung von Skalierung & Versatz).
       Reicht es selbst dann nicht, wird die Schrift der Fragen verkleinert. */
    const qrPlace = () => (d.qrPlace === 'header' ? 'header' : 'side');
    const qrSize = () => Math.max(150, Math.min(700, Number(d.qrSize) || 360));
    /* QR-Code: groß in eigener Spalte rechts (gut scanbar von weit weg) oder klein in der Titelleiste */
    function renderQr(c) {
      const url = audienceUrl(c);
      const short = esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
      const side = d.showQr && qrPlace() === 'side';
      el.classList.toggle('qr-side', side);
      el.style.setProperty('--qrs', qrSize() + 'px');
      const foot = el.querySelector('.qaw-foot'), sideEl = el.querySelector('.qaw-side');
      setHtml(foot, d.showQr && !side ? `<div class="qaw-qrt"><b>${esc(c.sub(d.qrText || 'Stell deine Frage'))}</b><span>${short}</span></div>${qrImg(url)}` : '');
      foot.style.display = d.showQr && !side ? '' : 'none';
      setHtml(sideEl, side ? `<div class="qaw-qrbox">${qrImg(url)}</div><b>${esc(c.sub(d.qrText || 'Stell deine Frage'))}</b><span>${short}</span>` : '');
      sideEl.style.display = side ? '' : 'none';
    }
    const totalWidth = () => (Number(d.width) || 1100) + (d.showQr && qrPlace() === 'side' ? qrSize() + 72 : 0);

    function geom() {
      const wrap = el.closest('.g-wrap');
      if (!wrap || !el.isConnected || !wrap.clientHeight) return null;
      const sc = Math.max(0.1, (Number(d.scale) || 100) / 100);
      return { wrap, sc, maxH: wrap.clientHeight / sc, maxW: wrap.clientWidth / sc };
    }
    let fitKey = '', zoom = 1;
    function fit() {
      if (!d || el.style.display === 'none') return;
      const G = geom();
      if (!G) return;
      // Ausgangszustand
      zoom = 1; el.style.zoom = ''; el.style.translate = ''; el.style.setProperty('--qfit', '1');
      el.style.width = Math.min(totalWidth(), G.maxW) + 'px';
      const box = el.querySelector('.qaw-list');
      const items = box ? [...box.children] : [];
      for (const n of items) n.style.display = '';
      const tooBig = () => el.offsetHeight * zoom > G.maxH + 0.5;
      // 1. Weniger Fragen: von der niedrigsten Priorität her ausblenden (aktive & neueste bleiben)
      for (let i = items.length - 1; i >= 0 && tooBig(); i--) if (!items[i].dataset.protect) items[i].style.display = 'none';
      // 2. Schrift der Fragen etwas verkleinern (bis 75 %)
      let k = 1;
      while (tooBig() && k > 0.75) { k = Math.round((k - 0.05) * 100) / 100; el.style.setProperty('--qfit', String(k)); }
      // 3. Ganze Wand verkleinern (Titel, QR, Fragen), bis alles passt
      // Beim Verkleinern frei werdende Breite nutzen (höchstens bis zur eingestellten Breite) → weniger Zeilen
      const baseW = totalWidth();
      while (tooBig() && zoom > 0.25) {
        zoom = Math.round((zoom - 0.05) * 100) / 100;
        el.style.zoom = String(zoom);
        el.style.width = Math.min(baseW, G.maxW / zoom) + 'px';
      }
      const hidden = items.filter((n) => n.style.display === 'none').length;
      const cnt = el.querySelector('.qaw-count');
      if (cnt && cnt.dataset.base !== undefined) setText(cnt, cnt.dataset.base + (hidden ? ` · +${hidden} weitere` : ''));
      keepOnStage(G);
      fitKey = [G.maxH, G.maxW, d.offsetX, d.offsetY, d.position].join('|');
    }
    /* Versatz so begrenzen, dass die Wand vollständig im Bild bleibt */
    function keepOnStage(G) {
      const stage = el.ownerDocument.getElementById('stage');
      if (!stage) return;
      const SW = stage.offsetWidth, SH = stage.offsetHeight, wr = G.wrap;
      const w = el.offsetWidth * zoom * G.sc, hh = el.offsetHeight * zoom * G.sc;
      const pos = wr.dataset.pos || 'center';
      const ox = Number(d.offsetX) || 0, oy = Number(d.offsetY) || 0;
      const y = wr.offsetTop + (/^top/.test(pos) ? 0 : /^bottom/.test(pos) ? wr.clientHeight - hh : (wr.clientHeight - hh) / 2) + oy;
      const x = wr.offsetLeft + (/left$/.test(pos) ? 0 : /right$/.test(pos) ? wr.clientWidth - w : (wr.clientWidth - w) / 2) + ox;
      const cy = Math.min(Math.max(y, 0), Math.max(0, SH - hh)) - y;
      const cx = Math.min(Math.max(x, 0), Math.max(0, SW - w)) - x;
      el.style.translate = cx || cy ? `${cx / (G.sc * zoom)}px ${cy / (G.sc * zoom)}px` : '';
    }

    function pickSingle(c, now) {
      const all = visibleQs(c.project);
      const src = d.singleSource;
      const active = all.find((q) => q.active);
      if (src === 'active') return active || null;
      if (src === 'activeOrTop') return active || sortQs(all, d.sort)[0] || null;
      if (src === 'newest') return all.slice().sort((a, b) => b.ts - a.ts)[0] || null;
      if (active) return active;
      const sorted = sortQs(all, d.sort);
      if (!sorted.length) return null;
      const idx = Math.floor((now - shownAt) / (Math.max(2, Number(d.rotateSeconds) || 8) * 1000)) % sorted.length;
      return sorted[idx];
    }

    function renderSingle(c, now) {
      const q = pickSingle(c, now);
      if (!el.querySelector('.qaw-one')) el.innerHTML = '<div class="qaw-main"><div class="qaw-h"><div class="qaw-ht"><span class="qaw-title"></span></div><div class="qaw-foot"></div></div><div class="qaw-one"></div></div><div class="qaw-side"></div>';
      setText(el.querySelector('.qaw-title'), c.sub(d.heading));
      el.querySelector('.qaw-h').style.display = d.heading || (d.showQr && qrPlace() === 'header') ? '' : 'none';
      const one = el.querySelector('.qaw-one');
      const key = q ? q.id + '|' + q.text + '|' + q.likes + '|' + q.active : 'empty';
      if (one._key !== key) {
        const changedQ = (one._qid || null) !== (q ? q.id : null);
        one._key = key; one._qid = q ? q.id : null;
        const html = q ? `<div class="qaw-item qaw-big${q.active ? ' active' : ''}">${itemInner(q)}</div>` : `<div class="qaw-empty">${esc(c.sub(d.emptyText))}</div>`;
        if (changedQ && one.innerHTML) {
          one.classList.add('swap');
          setTimeout(() => { one.innerHTML = html; one.classList.remove('swap'); fit(); }, 300);
        } else one.innerHTML = html;
      }
      renderQr(c);
      el.style.display = !q && !d.emptyText && !d.showQr ? 'none' : '';
      fit();
    }

    let lastFitCheck = 0;
    return {
      el, needsTick: true,
      depKey: (g, project) => JSON.stringify(visibleQs(project).map((q) => [q.id, q.text, q.author, q.likes, q.active, q.ts])),
      update(g, c) {
        d = g.data; ctx = c;
        if (g.shownAt !== shownAt) { shownAt = g.shownAt || c.now(); lastRot = -1; }
        el.className = 'qaw mode-' + d.mode;
        if (el.dataset.mode !== d.mode) { el.dataset.mode = d.mode; el.innerHTML = ''; }
        if (d.mode === 'single') renderSingle(c, c.now()); else renderWall(c);
      },
      tick(now) {
        // Regelmäßig nachmessen (Schriften geladen, Fenster/Skalierung geändert)
        if (d && now - lastFitCheck > 400) {
          lastFitCheck = now;
          const G = geom();
          if (G) {
            const key = [G.maxH, G.maxW, d.offsetX, d.offsetY, d.position].join('|');
            if (key !== fitKey || el.offsetHeight * zoom > G.maxH + 0.5) fit();
          }
        }
        if (!d || d.mode !== 'single' || d.singleSource !== 'rotate' || !ctx) return;
        const r = Math.floor((now - shownAt) / (Math.max(2, Number(d.rotateSeconds) || 8) * 1000));
        if (r !== lastRot) { lastRot = r; renderSingle(ctx, now); }
      }
    };
  };

  /* ---------------- Eigene Grafik (Builder) ---------------- */
  R.custom = () => {
    const el = div('cst');
    return {
      el, customAnim: true,
      update(g, c) {
        const layers = g.data.layers || [];
        const html = layers.map((l) => {
          const st = [`left:${l.x}px`, `top:${l.y}px`, `width:${l.w}px`, `height:${l.h}px`, `opacity:${(l.opacity === undefined ? 100 : l.opacity) / 100}`,
            `animation-delay:${Number(l.delay) || 0}ms`];
          if (l.rotation) st.push(`transform:rotate(${l.rotation}deg)`);
          if (l.type === 'rect' || l.type === 'ellipse') {
            st.push(`background:${l.color}`, `border-radius:${l.type === 'ellipse' ? '50%' : (Number(l.radius) || 0) + 'px'}`);
            if (l.border) st.push(`border:${Number(l.borderWidth) || 2}px solid ${l.border}`);
            if (l.shadow) st.push('box-shadow:var(--shadow)');
            return `<div class="cst-l an-${esc(l.anim || 'fade')}" style="${esc(st.join(';'))}"></div>`;
          }
          if (l.type === 'image') {
            st.push(`border-radius:${Number(l.radius) || 0}px`);
            return `<div class="cst-l an-${esc(l.anim || 'fade')}" style="${esc(st.join(';'))}"><img src="${esc(c.media(l.src))}" style="object-fit:${esc(l.fit || 'contain')}"></div>`;
          }
          const justify = l.align === 'center' ? 'center' : l.align === 'right' ? 'flex-end' : 'flex-start';
          const valign = l.valign === 'top' ? 'flex-start' : l.valign === 'bottom' ? 'flex-end' : 'center';
          st.push(`color:${l.color}`, `font-size:${Number(l.fontSize) || 40}px`, `font-weight:${l.fontWeight || 700}`, `justify-content:${justify}`, `align-items:${valign}`, `text-align:${l.align || 'left'}`);
          if (l.font) st.push(`font-family:${l.font}`);
          if (l.italic) st.push('font-style:italic');
          if (l.uppercase) st.push('text-transform:uppercase');
          if (l.letterSpacing) st.push(`letter-spacing:${l.letterSpacing}px`);
          if (l.shadow) st.push('text-shadow:var(--tshadow)');
          if (l.bg) st.push(`background:${l.bg}`, `padding:0 ${Number(l.padding) || 0}px`, `border-radius:${Number(l.radius) || 0}px`);
          return `<div class="cst-l text an-${esc(l.anim || 'fade')}" style="${esc(st.join(';'))}">${nl(c.sub(l.text))}</div>`;
        }).join('');
        const st = el.classList.contains('out') ? 'out' : 'in';
        setHtml(el, html);
        el.className = 'cst ' + st;
      },
      animIn() { el.classList.remove('out'); el.classList.add('in'); },
      animOut() { el.classList.remove('in'); el.classList.add('out'); el.style.transition = 'opacity calc(var(--anim-dur) * .7)'; el.style.opacity = '0'; return 450; }
    };
  };

  window.CueRenderers = R;
  window.CueRenderUtil = { esc, nl, timerText };
})();
