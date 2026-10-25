/* CueGFX – Ausgabe-Engine: synchronisiert Grafiken, Theme und Animationen für einen Ausgang */
(function () {
  'use strict';
  const T = window.CueTypes, R = window.CueRenderers;
  const params = new URLSearchParams(location.search);
  const outputId = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '1');
  const isPreview = outputId === 'preview';
  const stage = document.getElementById('stage');
  const statusEl = document.getElementById('status');
  const themeCss = document.getElementById('theme-css');
  const customCss = document.getElementById('custom-css');
  const graphicCss = document.getElementById('graphic-css');
  const client = new CueClient({ role: 'output', output: outputId });
  const instances = new Map();
  let state = null, theme = {}, vars = {}, outCfg = null, lastCssKey = '', lastGraphicCss = '', info = {};
  const publicBase = () => (info.lan && info.lan[0]) || location.origin;

  if (params.get('guides') === '1') document.body.classList.add('guides');

  /* ---------- Monitor-Modus (nur Vorschau-Fenster in der Steuerung, ?monitor=1) ----------
     Misst Pegel und Restzeit laufender Video-/Audio-Grafiken und meldet sie an die Steuerung.
     Der Ton wird dabei nur analysiert, nicht hörbar ausgegeben. */
  const Mon = params.get('monitor') === '1' && window.parent !== window ? (function () {
    let ac = null, sink = null;
    const items = new Map();
    const audioCtx = () => {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        sink = ac.createGain(); sink.gain.value = 0; sink.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    };
    window.addEventListener('message', (e) => { if (e.source === window.parent && e.data && e.data.cueMon === 'resume' && ac) ac.resume().catch(() => {}); });
    const db = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -90);
    function attach(id, m, getG) {
      if (items.has(id) && items.get(id).m === m) return true;
      const it = { m, getG, an: null, buf: new Float32Array(2048), mono: 0 };
      try {
        const a = audioCtx();
        if (a) {
          const src = m._cueSrc || (m._cueSrc = a.createMediaElementSource(m));
          const split = a.createChannelSplitter(2);
          src.connect(split);
          it.an = [0, 1].map((ch) => { const x = a.createAnalyser(); x.fftSize = 2048; split.connect(x, ch); x.connect(sink); return x; });
        }
      } catch (e) { it.an = null; }
      items.set(id, it);
      return !!it.an;
    }
    function level(it, ch) {
      const an = it.an && it.an[ch]; if (!an) return { rms: -90, peak: -90 };
      an.getFloatTimeDomainData(it.buf);
      let sum = 0, pk = 0;
      for (let i = 0; i < it.buf.length; i++) { const v = it.buf[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
      return { rms: db(Math.sqrt(sum / it.buf.length)), peak: db(pk) };
    }
    setInterval(() => {
      const media = [];
      for (const [id, it] of items) {
        const g = it.getG && it.getG();
        if (!g || !it.m.isConnected) continue;
        const d = g.data || {};
        let L = level(it, 0), Rr = level(it, 1);
        // Mono-Quellen: rechter Kanal bleibt stumm → linken Kanal spiegeln
        if (Rr.peak <= -89 && L.peak > -60) it.mono++; else if (Rr.peak > -89) it.mono = 0;
        if (it.mono > 3) Rr = L;
        if (d.muted || it.m.paused) { L = { rms: -90, peak: -90 }; Rr = L; }
        const dur = it.m.duration;
        const end = Number(d.trimEnd) > 0 ? Math.min(Number(d.trimEnd), isFinite(dur) ? dur : Infinity) : dur;
        media.push({ id, name: g.name, type: g.type, cur: it.m.currentTime || 0, end: isFinite(end) ? end : 0, start: Number(d.trimStart) || 0,
          loop: !!d.loop, paused: it.m.paused, muted: !!d.muted, l: L, r: Rr, ready: !!it.an });
      }
      try { window.parent.postMessage({ cueMon: 'state', media }, location.origin); } catch (_) {}
    }, 66);
    return { attach, detach: (id) => items.delete(id) };
  })() : null;

  /* ---------- Skalierung der 1920×1080-Bühne ---------- */
  let scale = 1;
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    scale = Math.min(w / 1920, h / 1080);
    const ox = (w - 1920 * scale) / 2, oy = (h - 1080 * scale) / 2;
    stage.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- Variablen ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function builtin(name) {
    const d = new Date(client.now());
    switch (name) {
      case 'time': return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      case 'time:s': return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      case 'date': return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      case 'weekday': return d.toLocaleDateString('de-DE', { weekday: 'long' });
      case 'year': return String(d.getFullYear());
      case 'output': return outCfg ? outCfg.name : outputId;
      case 'project': return state ? state.name : '';
      case 'audience_url': return publicBase() + '/audience';
    }
    return undefined;
  }
  function sub(str) {
    if (str === undefined || str === null) return '';
    str = String(str);
    if (str.indexOf('{{') < 0) return str;
    return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => {
      const b = builtin(name);
      if (b !== undefined) return b;
      const parts = name.split('|');
      const v = vars[parts[0].trim()];
      if (v !== undefined && v !== '') return v;
      return parts[1] !== undefined ? parts[1].trim() : '';
    });
  }
  function media(v) {
    if (!v) return '';
    v = String(v);
    if (/^(https?:|data:|blob:|\/)/.test(v)) return v;
    return '/media/' + encodeURIComponent(v);
  }

  /* ---------- Theme ---------- */
  function applyTheme(th) {
    const css = `:root{--primary:${th.primary};--secondary:${th.secondary};--accent:${th.accent};--text:${th.text};--text-on-primary:${th.textOnPrimary};` +
      `--panel:${th.panel};--font:${th.font};--font-heading:${th.headingFont};--radius:${Number(th.radius) || 0}px;--shadow-a:${Number(th.shadow) || 0};` +
      `--anim-dur:${Number(th.animDuration) || 600}ms;--safe:${Number(th.safeMargin) || 0}px;--fs:${(Number(th.fontScale) || 100) / 100};}`;
    if (themeCss.textContent !== css) themeCss.textContent = css;
    document.body.classList.toggle('no-tshadow', th.textShadow === false);
    if (customCss.textContent !== (th.customCss || '')) customCss.textContent = th.customCss || '';
  }

  function applyGraphicCss(graphics) {
    const parts = [];
    for (const g of graphics) {
      const css = String(g.data.css || '').trim();
      if (!css) continue;
      const sel = `.g-wrap[data-gid="${g.id}"]`;
      parts.push(css.includes('{') ? css.replace(/&/g, sel) : `${sel} .g-anim > * { ${css} }`);
    }
    const all = parts.join('\n');
    if (all !== lastGraphicCss) { lastGraphicCss = all; graphicCss.textContent = all; }
  }

  function applyBackground() {
    let bg = 'transparent';
    if (params.get('transparent') === '1') bg = 'transparent';
    else if (params.get('bg')) bg = params.get('bg');
    else if (outCfg && outCfg.background) bg = outCfg.background;
    if (isPreview && !params.get('bg')) bg = 'transparent';
    document.body.classList.toggle('bg-solid', bg !== 'transparent');
    document.body.style.setProperty('--out-bg', bg);
  }

  function audioEnabled() {
    if (params.get('audio') === '0') return false;
    if (params.get('audio') === '1') return true;
    if (isPreview) return false;
    return !!(outCfg && outCfg.audio);
  }

  /* ---------- Grafik-Instanzen ---------- */
  function animName(g) {
    const a = g.data.animation;
    return !a || a === 'theme' ? (theme.animation || 'slide') : a;
  }

  function makeCtx(inst) {
    return {
      sub, media, esc: window.CueRenderUtil.esc,
      now: () => client.now(),
      get project() { return state; },
      get audio() { return audioEnabled(); },
      stageScale: () => 1,
      publicBase,
      monitor: Mon,
      setFull: (on) => { inst.wrap.classList.toggle('full', on || !!inst.typeDef.fullscreen); },
      ended: (g) => { if (!isPreview) client.cmd('media.ended', { id: g.id, shownAt: g.shownAt }).catch(() => {}); }
    };
  }

  function layout(inst, g) {
    const d = g.data, td = inst.typeDef;
    inst.wrap.dataset.pos = td.fullscreen ? 'center' : (d.position || 'bottom-left');
    inst.wrap.classList.toggle('full', !!td.fullscreen || ((g.type === 'image' || g.type === 'video') && !!d.fullscreen));
    inst.place.style.setProperty('--ox', (Number(d.offsetX) || 0) + 'px');
    inst.place.style.setProperty('--oy', (Number(d.offsetY) || 0) + 'px');
    inst.place.style.setProperty('--sc', ((Number(d.scale) || 100) / 100).toString());
  }

  function create(g) {
    const factory = R[g.type];
    if (!factory) return null;
    const typeDef = T.TYPES[g.type];
    const wrap = document.createElement('div'); wrap.className = 'g-wrap'; wrap.dataset.gid = g.id; wrap.dataset.type = g.type;
    const place = document.createElement('div'); place.className = 'g-place';
    const anim = document.createElement('div'); anim.className = 'g-anim';
    const inst = { id: g.id, type: g.type, typeDef, wrap, place, anim, removing: false, shownAt: g.shownAt };
    inst.ctx = makeCtx(inst);
    inst.r = factory(inst.ctx);
    anim.appendChild(inst.r.el);
    place.appendChild(anim);
    wrap.appendChild(place);
    stage.appendChild(wrap);
    layout(inst, g);
    try { inst.r.update(g, inst.ctx); } catch (e) { console.error('Renderer-Fehler', g.type, e); }
    inst.lastJson = JSON.stringify(g.data);
    inst.lastKey = inst.r.depKey ? inst.lastJson + '\u0001' + inst.r.depKey(g, state) : inst.lastJson;
    const name = animName(g);
    if (inst.r.customAnim) { anim.className = 'g-anim'; inst.r.animIn && inst.r.animIn(); }
    else anim.className = `g-anim a-${name} in`;
    instances.set(g.id, inst);
    return inst;
  }

  function remove(inst, g) {
    if (inst.removing) return;
    inst.removing = true;
    instances.delete(inst.id);
    let dur;
    if (inst.r.customAnim && inst.r.animOut) dur = inst.r.animOut();
    else {
      const name = g ? animName(g) : (theme.animation || 'slide');
      inst.anim.className = `g-anim a-${name} out`;
      dur = name === 'none' ? 0 : (Number(theme.animDuration) || 600) * 0.75;
    }
    setTimeout(() => {
      try { inst.r.destroy && inst.r.destroy(); } catch (_) {}
      inst.wrap.remove();
    }, dur + 60);
  }

  function visible(g) {
    if (isPreview) return !!g.preview;
    return !!g.live && Array.isArray(g.outputs) && g.outputs.includes(outputId);
  }

  function sync() {
    if (!state) return;
    outCfg = (state.settings.outputs || []).find((o) => o.id === outputId) || (isPreview ? { id: 'preview', name: 'Vorschau', audio: false } : null);
    window.CUE_OUTPUT_LABEL = outCfg ? outCfg.name : outputId;
    applyBackground();
    const cssKey = JSON.stringify(theme);
    if (cssKey !== lastCssKey) { lastCssKey = cssKey; applyTheme(theme); }
    applyGraphicCss(state.graphics);
    const n = state.graphics.length;
    const seen = new Set();
    state.graphics.forEach((g, idx) => {
      if (!visible(g)) return;
      seen.add(g.id);
      let inst = instances.get(g.id);
      // Neu eingeblendet (oder erneut ausgelöst) → neue Instanz mit Animation
      if (inst && !isPreview && g.shownAt && inst.shownAt && g.shownAt !== inst.shownAt && ['celebration', 'credits', 'video', 'audio', 'lowerthird_anim', 'custom'].includes(g.type)) {
        remove(inst, g); inst = null;
      }
      if (!inst) inst = create(g);
      if (!inst) return;
      inst.shownAt = g.shownAt;
      inst.wrap.style.zIndex = String(n - idx);
      const json = JSON.stringify(g.data);
      layout(inst, g);
      // Grafiken, die Projektdaten anzeigen (Umfragen, Q&A), auch bei deren Änderung neu zeichnen
      const key = inst.r.depKey ? json + '\u0001' + inst.r.depKey(g, state) : json;
      if (key !== inst.lastKey || inst.varsDirty) {
        inst.lastKey = key;
        inst.lastJson = json;
        try { inst.r.update(g, inst.ctx); } catch (e) { console.error(e); }
      }
      inst.g = g;
    });
    for (const inst of [...instances.values()]) {
      if (!seen.has(inst.id)) remove(inst, state.graphics.find((x) => x.id === inst.id));
    }
  }

  /* Variablen haben sich geändert → alle Grafiken, die Variablen nutzen, neu zeichnen */
  function refreshVars(onlyClock) {
    for (const inst of instances.values()) {
      if (!inst.g) continue;
      if (inst.lastJson.indexOf('{{') < 0) continue;
      if (onlyClock && !/\{\{\s*(time|date|weekday)/.test(inst.lastJson)) continue;
      try { inst.r.update(inst.g, inst.ctx); } catch (e) { console.error(e); }
    }
  }

  /* ---------- Tick-Schleife für Timer, Ticker, Effekte ---------- */
  function frame() {
    const now = client.now();
    for (const inst of instances.values()) if (inst.r.needsTick && inst.r.tick) { try { inst.r.tick(now, inst.ctx); } catch (e) { console.error(e); } }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => refreshVars(true), 1000);

  /* ---------- Verbindung ---------- */
  client.on('state', (m) => {
    const varsJson = JSON.stringify(m.vars);
    const varsChanged = varsJson !== JSON.stringify(vars);
    state = m.project; theme = state.theme || {}; vars = m.vars || {}; info = m.info || info;
    sync();
    if (varsChanged) refreshVars(false);
  });
  const showStatus = isPreview || params.get('debug') === '1';
  client.on('close', () => { if (showStatus) { statusEl.hidden = false; statusEl.textContent = 'Keine Verbindung zum CueGFX-Server …'; } });
  client.on('open', () => { statusEl.hidden = true; });

  // Schriften nachladen, wenn neue Medien hochgeladen werden
  setInterval(() => {
    const l = document.getElementById('fonts-css');
    if (l && document.visibilityState === 'visible') {
      fetch('/api/fonts.css').then((r) => r.text()).then((css) => {
        if (css !== l.dataset.css) {
          l.dataset.css = css;
          const s = document.createElement('style'); s.textContent = css; s.id = 'fonts-css'; s.dataset.css = css;
          l.replaceWith(s);
        }
      }).catch(() => {});
    }
  }, 15000);
})();
