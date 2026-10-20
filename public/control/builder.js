/* CueGFX – Drag-&-Drop-Builder für eigene Grafiken */
(function () {
  'use strict';
  const { h } = window.UI;
  const ANIMS = [['fade', 'Fade'], ['slide-left', 'Von links'], ['slide-right', 'Von rechts'], ['slide-up', 'Von unten'], ['slide-down', 'Von oben'], ['scale', 'Pop'], ['wipe', 'Wipe']];
  const FONTS = [['', 'Theme-Schrift'], ['var(--font-heading)', 'Theme-Überschrift'], ['Arial, sans-serif', 'Arial'], ['"Helvetica Neue", Helvetica, sans-serif', 'Helvetica'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times'], ['Impact, sans-serif', 'Impact'], ['"Courier New", monospace', 'Courier'], ['Verdana, sans-serif', 'Verdana'], ['"Trebuchet MS", sans-serif', 'Trebuchet']];
  let seq = 0;
  const nid = () => 'l' + Date.now().toString(36) + (seq++);
  const esc = (s) => String(s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function Builder(initial, onChange, env) {
    let layers = JSON.parse(JSON.stringify(initial || []));
    let sel = layers.length ? layers[layers.length - 1].id : null;
    const stage = h('div', { class: 'bld-stage' });
    const canvas = h('div', { class: 'bld-canvas', tabindex: '0' }, stage);
    const layerList = h('div', { class: 'bld-layers' });
    const props = h('div', { class: 'bld-props' });
    const root = h('div', { class: 'bld' },
      h('div', { class: 'bld-canvas-wrap' }, canvas, h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Ziehen zum Verschieben, Kreis unten rechts zum Skalieren. Pfeiltasten verschieben (mit Umschalt 10 px), Entf löscht. Raster 10 px – Umschalt beim Ziehen für pixelgenau. Variablen wie {{name}} funktionieren in Texten.')),
      h('div', { class: 'bld-side' },
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => add('text') }, '+ Text'),
          h('button', { class: 'btn sm', onclick: () => add('rect') }, '+ Fläche'),
          h('button', { class: 'btn sm', onclick: () => add('ellipse') }, '+ Kreis'),
          h('button', { class: 'btn sm', onclick: () => add('image') }, '+ Bild')),
        layerList),
      props);
    let scale = 0.3, dragging = false;
    const ro = new ResizeObserver(() => { scale = canvas.clientWidth / 1920; stage.style.transform = `scale(${scale})`; });
    ro.observe(canvas);

    const emit = () => onChange(JSON.parse(JSON.stringify(layers)));
    const cur = () => layers.find((l) => l.id === sel);

    function add(type) {
      const base = { id: nid(), type, x: 760, y: 440, w: 400, h: 200, opacity: 100, anim: 'fade', delay: 0, rotation: 0 };
      if (type === 'text') Object.assign(base, { w: 800, h: 100, text: 'Neuer Text', color: '#ffffff', fontSize: 64, fontWeight: 800, align: 'left', valign: 'center', shadow: true, x: 560, y: 490 });
      if (type === 'rect') Object.assign(base, { color: 'var(--panel)', radius: 12, shadow: true });
      if (type === 'ellipse') Object.assign(base, { color: 'var(--primary)', w: 240, h: 240, x: 840, y: 420 });
      if (type === 'image') Object.assign(base, { src: '', fit: 'contain', radius: 0, w: 400, h: 300 });
      layers.push(base); sel = base.id; emit(); render();
    }

    function layerHtml(l) {
      const st = [`left:${l.x}px`, `top:${l.y}px`, `width:${l.w}px`, `height:${l.h}px`, `opacity:${(l.opacity === undefined ? 100 : l.opacity) / 100}`];
      if (l.rotation) st.push(`transform:rotate(${l.rotation}deg)`);
      if (l.type === 'rect' || l.type === 'ellipse') {
        st.push(`background:${l.color}`, `border-radius:${l.type === 'ellipse' ? '50%' : (Number(l.radius) || 0) + 'px'}`);
        if (l.border) st.push(`border:${Number(l.borderWidth) || 2}px solid ${l.border}`);
        if (l.shadow) st.push('box-shadow:var(--shadow)');
        return { st, inner: '' };
      }
      if (l.type === 'image') { st.push(`border-radius:${Number(l.radius) || 0}px`); return { st, inner: l.src ? `<img src="${esc(UI.mediaUrl(l.src))}" style="object-fit:${esc(l.fit || 'contain')}">` : '<div style="margin:auto;font-size:40px;color:#888">🖼</div>' }; }
      st.push(`color:${l.color}`, `font-size:${Number(l.fontSize) || 40}px`, `font-weight:${l.fontWeight || 700}`, `font-family:${l.font || 'var(--font)'}`,
        `justify-content:${l.align === 'center' ? 'center' : l.align === 'right' ? 'flex-end' : 'flex-start'}`, `align-items:${l.valign === 'top' ? 'flex-start' : l.valign === 'bottom' ? 'flex-end' : 'center'}`, `text-align:${l.align || 'left'}`);
      if (l.italic) st.push('font-style:italic');
      if (l.uppercase) st.push('text-transform:uppercase');
      if (l.letterSpacing) st.push(`letter-spacing:${l.letterSpacing}px`);
      if (l.shadow) st.push('text-shadow:0 2px 6px rgba(0,0,0,.35)');
      if (l.bg) st.push(`background:${l.bg}`, `padding:0 ${Number(l.padding) || 0}px`, `border-radius:${Number(l.radius) || 0}px`);
      return { st, inner: esc(env.sub ? env.sub(l.text) : l.text).replace(/\n/g, '<br>') };
    }

    function drawStage() {
      const vars = env.themeVars ? env.themeVars() : {};
      for (const [k, v] of Object.entries(vars)) stage.style.setProperty(k, v);
      stage.style.fontFamily = 'var(--font)';
      stage.innerHTML = '';
      layers.forEach((l, i) => {
        const { st, inner } = layerHtml(l);
        const el = h('div', { class: `bld-l ${l.type}${l.id === sel ? ' sel' : ''}`, style: null, dataset: { id: l.id } });
        el.setAttribute('style', st.join(';') + `;z-index:${i + 1}`);
        el.innerHTML = inner;
        el.appendChild(h('div', { class: 'rh' }));
        stage.appendChild(el);
      });
      stage.appendChild(h('div', { class: 'bld-guides' }));
    }

    function drawList() {
      layerList.innerHTML = '';
      [...layers].reverse().forEach((l) => {
        const i = layers.indexOf(l);
        const name = l.type === 'text' ? (l.text || 'Text').split('\n')[0] : l.type === 'image' ? 'Bild ' + (l.src || '') : l.type === 'ellipse' ? 'Kreis' : 'Fläche';
        layerList.appendChild(h('div', { class: 'bl' + (l.id === sel ? ' sel' : ''), onclick: () => { sel = l.id; render(); } },
          h('b', null, l.type === 'text' ? 'T' : l.type === 'image' ? '🖼' : l.type === 'ellipse' ? '●' : '■'), h('span', null, name),
          h('button', { class: 'btn xs', title: 'Nach vorne', disabled: i === layers.length - 1, onclick: (e) => { e.stopPropagation(); [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; emit(); render(); } }, '↑'),
          h('button', { class: 'btn xs', title: 'Nach hinten', disabled: i === 0, onclick: (e) => { e.stopPropagation(); [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; emit(); render(); } }, '↓'),
          h('button', { class: 'btn xs', title: 'Duplizieren', onclick: (e) => { e.stopPropagation(); const c = JSON.parse(JSON.stringify(l)); c.id = nid(); c.x += 20; c.y += 20; layers.splice(i + 1, 0, c); sel = c.id; emit(); render(); } }, '⧉'),
          h('button', { class: 'btn xs danger', title: 'Löschen', onclick: (e) => { e.stopPropagation(); layers.splice(i, 1); if (sel === l.id) sel = null; emit(); render(); } }, '✕')));
      });
      if (!layers.length) layerList.appendChild(h('div', { class: 'hint' }, 'Noch keine Ebenen.'));
    }

    function drawProps() {
      props.innerHTML = '';
      const l = cur();
      if (!l) return;
      const F = (def) => {
        const f = UI.field(def, l[def.key] !== undefined ? l[def.key] : def.default, (v) => { l[def.key] = v; emit(); drawStage(); if (def.key === 'text' || def.key === 'src') drawList(); }, env);
        f.dataset.key = def.key;
        return f;
      };
      const common = [
        { key: 'x', label: 'X', type: 'number' }, { key: 'y', label: 'Y', type: 'number' },
        { key: 'w', label: 'Breite', type: 'number', min: 1 }, { key: 'h', label: 'Höhe', type: 'number', min: 1 },
        { key: 'opacity', label: 'Deckkraft %', type: 'number', min: 0, max: 100 }, { key: 'rotation', label: 'Drehung °', type: 'number' },
        { key: 'anim', label: 'Animation', type: 'select', default: 'fade', options: ANIMS }, { key: 'delay', label: 'Verzögerung (ms)', type: 'number', min: 0, step: 50 }
      ];
      let specific = [];
      if (l.type === 'text') specific = [
        { key: 'text', label: 'Text', type: 'textarea', full: true },
        { key: 'color', label: 'Farbe', type: 'color' }, { key: 'fontSize', label: 'Größe (px)', type: 'number', min: 4 },
        { key: 'fontWeight', label: 'Stärke', type: 'select', default: '700', options: [['300', 'Leicht'], ['400', 'Normal'], ['500', 'Medium'], ['600', 'Halbfett'], ['700', 'Fett'], ['800', 'Extrafett'], ['900', 'Black']] },
        { key: 'font', label: 'Schrift', type: 'select', default: '', options: FONTS.concat((env.fonts ? env.fonts() : []).map((f) => [`"${f}"`, f])) },
        { key: 'align', label: 'Ausrichtung', type: 'select', default: 'left', options: [['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']] },
        { key: 'valign', label: 'Vertikal', type: 'select', default: 'center', options: [['top', 'Oben'], ['center', 'Mitte'], ['bottom', 'Unten']] },
        { key: 'letterSpacing', label: 'Zeichenabstand', type: 'number', step: 0.5 },
        { key: 'bg', label: 'Hintergrund (leer = keiner)', type: 'color' }, { key: 'padding', label: 'Innenabstand', type: 'number', min: 0 },
        { key: 'radius', label: 'Eckenradius', type: 'number', min: 0 },
        { key: 'shadow', label: 'Schatten', type: 'toggle' }, { key: 'uppercase', label: 'Großbuchstaben', type: 'toggle' }, { key: 'italic', label: 'Kursiv', type: 'toggle' }];
      if (l.type === 'rect' || l.type === 'ellipse') specific = [
        { key: 'color', label: 'Füllung', type: 'color' }, { key: 'radius', label: 'Eckenradius', type: 'number', min: 0 },
        { key: 'border', label: 'Rahmenfarbe', type: 'color' }, { key: 'borderWidth', label: 'Rahmenbreite', type: 'number', min: 0 },
        { key: 'shadow', label: 'Schatten', type: 'toggle' }];
      if (l.type === 'image') specific = [
        { key: 'src', label: 'Bild', type: 'media', kind: 'image', full: true },
        { key: 'fit', label: 'Einpassen', type: 'select', default: 'contain', options: [['contain', 'Enthalten'], ['cover', 'Füllen'], ['fill', 'Strecken']] },
        { key: 'radius', label: 'Eckenradius', type: 'number', min: 0 }];
      props.append(...specific.map(F), ...common.map(F));
      props.appendChild(h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'Farben akzeptieren auch Theme-Werte wie var(--primary), var(--accent), var(--panel) oder rgba(…).'));
    }

    function syncProps() {
      const l = cur(); if (!l) return;
      for (const f of props.querySelectorAll('.field[data-key]')) f.setValue && f.setValue(l[f.dataset.key]);
    }

    function render() { drawStage(); drawList(); drawProps(); }

    /* Ziehen & Skalieren */
    canvas.addEventListener('pointerdown', (e) => {
      const lel = e.target.closest('.bld-l');
      if (!lel) { sel = null; render(); return; }
      const l = layers.find((x) => x.id === lel.dataset.id);
      if (!l) return;
      if (sel !== l.id) { sel = l.id; render(); }
      const resizing = e.target.classList.contains('rh');
      const sx = e.clientX, sy = e.clientY, ox = l.x, oy = l.y, ow = l.w, oh = l.h;
      canvas.setPointerCapture(e.pointerId);
      dragging = true;
      canvas.focus();
      const elNow = () => stage.querySelector(`.bld-l[data-id="${l.id}"]`);
      const move = (ev) => {
        const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
        const snap = ev.shiftKey ? 1 : 10;
        const r = (v) => Math.round(v / snap) * snap;
        if (resizing) { l.w = Math.max(4, r(ow + dx)); l.h = Math.max(4, r(oh + dy)); }
        else { l.x = r(ox + dx); l.y = r(oy + dy); }
        const el = elNow();
        if (el) { el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; el.style.width = l.w + 'px'; el.style.height = l.h + 'px'; }
        syncProps();
      };
      const up = () => { dragging = false; canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); if (l.x !== ox || l.y !== oy || l.w !== ow || l.h !== oh) emit(); };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('keydown', (e) => {
      const l = cur(); if (!l) return;
      const st = e.shiftKey ? 10 : 1;
      const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
      if (k) { e.preventDefault(); l.x += k[0]; l.y += k[1]; drawStage(); syncProps(); emit(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); layers = layers.filter((x) => x.id !== l.id); sel = null; emit(); render(); }
    });

    render();
    root.setValue = (v) => {
      if (dragging || UI.isEditing(props)) return;
      if (JSON.stringify(v || []) === JSON.stringify(layers)) return;
      layers = JSON.parse(JSON.stringify(v || []));
      if (sel && !cur()) sel = null;
      render();
    };
    root.refresh = drawStage;
    return root;
  }

  window.CueBuilder = Builder;
})();
