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
        const team = (side) => {
          const n = side === 'a' ? d.teamA : d.teamB, col = side === 'a' ? d.colorA : d.colorB, logo = side === 'a' ? d.logoA : d.logoB;
          return `<div class="sc-team ${side}" style="--tc:${esc(col)}">${logo ? `<img src="${esc(c.media(logo))}">` : ''}<span>${esc(c.sub(n))}</span></div>`;
        };
        const score = (side) => `<div class="sc-score ${side}" style="--tc:${esc(side === 'a' ? d.colorA : d.colorB)}">${esc(side === 'a' ? d.scoreA : d.scoreB)}</div>`;
        const info = (d.period || d.showClock) ? `<div class="sc-info">${d.period ? `<div>${esc(c.sub(d.period))}</div>` : ''}${d.showClock ? '<div class="clock"></div>' : ''}</div>` : '';
        el.className = `sc ${d.style}`;
        setHtml(el, `<div class="sc-row">${team('a')}${score('a')}${score('b')}${team('b')}</div>${info}`);
        clockEl = el.querySelector('.clock');
        for (const side of ['a', 'b']) {
          const v = side === 'a' ? d.scoreA : d.scoreB;
          if (last[side] !== undefined && last[side] !== v) {
            const s = el.querySelector('.sc-score.' + side);
            if (s) { s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
          }
          last[side] = v;
        }
      },
      tick(now) { if (clockEl && data) setText(clockEl, timerText(data, now).text); }
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
      const newest = d.showNewest ? all.slice().sort((a, b) => b.ts - a.ts)[0] : null;
      let rest = sortQs(all.filter((q) => q !== newest || q.active), d.sort);
      if (d.activeFirst) { const a = rest.find((q) => q.active); if (a) rest = [a].concat(rest.filter((q) => q !== a)); }
      if (newest && newest.active) { /* aktive neueste Frage steht oben in der Liste, nicht doppelt */ }
      const top = rest.slice(0, Math.max(1, Number(d.count) || 5));
      const showNew = newest && !top.includes(newest);
      if (!el.querySelector('.qaw-list')) {
        el.innerHTML = '<div class="qaw-h"><span class="qaw-title"></span><span class="qaw-count"></span></div><div class="qaw-list"></div><div class="qaw-new"><div class="qaw-new-label">Neueste Frage</div><div class="qaw-item"></div></div><div class="qaw-foot"></div><div class="qaw-empty"></div>';
      }
      setText(el.querySelector('.qaw-title'), c.sub(d.heading));
      el.querySelector('.qaw-h').style.display = d.heading ? '' : 'none';
      setText(el.querySelector('.qaw-count'), all.length ? `${all.length} Frage${all.length === 1 ? '' : 'n'}` : '');
      // FLIP: Positionen merken, neu ordnen, Bewegung animieren
      const box = el.querySelector('.qaw-list');
      const before = new Map([...box.children].map((n) => [n.dataset.id, n.getBoundingClientRect().top]));
      const keep = new Set(top.map((q) => q.id));
      for (const n of [...box.children]) if (!keep.has(n.dataset.id)) n.remove();
      top.forEach((q, i) => {
        let n = box.querySelector(`[data-id="${CSS.escape(q.id)}"]`);
        if (!n) { n = document.createElement('div'); n.dataset.id = q.id; n.className = 'qaw-item enter'; requestAnimationFrame(() => requestAnimationFrame(() => n.classList.remove('enter'))); }
        n.classList.toggle('active', !!q.active);
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
      const foot = el.querySelector('.qaw-foot');
      const url = audienceUrl(c);
      setHtml(foot, d.showQr ? `${qrImg(url)}<div><b>Stell deine Frage</b><span>${esc(url.replace(/^https?:\/\//, ''))}</span></div>` : '');
      foot.style.display = d.showQr ? '' : 'none';
      const empty = el.querySelector('.qaw-empty');
      setText(empty, all.length ? '' : c.sub(d.emptyText));
      empty.style.display = all.length ? 'none' : '';
      el.style.display = !all.length && !d.emptyText && !d.showQr ? 'none' : '';
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
      if (!el.querySelector('.qaw-one')) el.innerHTML = '<div class="qaw-h"><span class="qaw-title"></span></div><div class="qaw-one"></div><div class="qaw-foot"></div>';
      setText(el.querySelector('.qaw-title'), c.sub(d.heading));
      el.querySelector('.qaw-h').style.display = d.heading ? '' : 'none';
      const one = el.querySelector('.qaw-one');
      const key = q ? q.id + '|' + q.text + '|' + q.likes + '|' + q.active : 'empty';
      if (one._key !== key) {
        const changedQ = (one._qid || null) !== (q ? q.id : null);
        one._key = key; one._qid = q ? q.id : null;
        const html = q ? `<div class="qaw-item qaw-big${q.active ? ' active' : ''}">${itemInner(q)}</div>` : `<div class="qaw-empty">${esc(c.sub(d.emptyText))}</div>`;
        if (changedQ && one.innerHTML) {
          one.classList.add('swap');
          setTimeout(() => { one.innerHTML = html; one.classList.remove('swap'); }, 300);
        } else one.innerHTML = html;
      }
      const foot = el.querySelector('.qaw-foot');
      const url = audienceUrl(c);
      setHtml(foot, d.showQr ? `${qrImg(url)}<div><b>Stell deine Frage</b><span>${esc(url.replace(/^https?:\/\//, ''))}</span></div>` : '');
      foot.style.display = d.showQr ? '' : 'none';
      el.style.display = !q && !d.emptyText && !d.showQr ? 'none' : '';
    }

    return {
      el, needsTick: true,
      depKey: (g, project) => JSON.stringify(visibleQs(project).map((q) => [q.id, q.text, q.author, q.likes, q.active, q.ts])),
      update(g, c) {
        d = g.data; ctx = c;
        if (g.shownAt !== shownAt) { shownAt = g.shownAt || c.now(); lastRot = -1; }
        el.className = 'qaw mode-' + d.mode;
        el.style.width = (Number(d.width) || 1100) + 'px';
        if (el.dataset.mode !== d.mode) { el.dataset.mode = d.mode; el.innerHTML = ''; }
        if (d.mode === 'single') renderSingle(c, c.now()); else renderWall(c);
      },
      tick(now) {
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
