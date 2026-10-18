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
