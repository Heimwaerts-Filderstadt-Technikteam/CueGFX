/* CueGFX – Builder für eigene Kamerarahmen: Bausteine stapeln, live ansehen, als Vorlage speichern */
(function () {
  'use strict';
  const { h } = window.UI;
  const FD = window.CueFrameDraw;

  function FrameBuilder(initial, onChange, env, getData) {
    let layers = JSON.parse(JSON.stringify(Array.isArray(initial) ? initial : []));
    let sel = layers.length ? layers[0].id : null;
    const cv = h('canvas', { class: 'fb-cv', width: 960, height: 540 });
    const x = cv.getContext('2d');
    const list = h('div', { class: 'fb-list' });
    const props = h('div', { class: 'fb-props' });
    const imgs = new Map();
    const emit = () => onChange(JSON.parse(JSON.stringify(layers)));
    const cur = () => layers.find((l) => l.id === sel);

    const tplMenu = (anchor) => {
      const tpls = (window.CueState && window.CueState.info && window.CueState.info.frameTemplates) || [];
      const items = [{ label: 'Beispiele', header: true }];
      for (const s of FD.STARTERS) items.push({ label: s.name, action: () => replace(s.layers()) });
      items.push('-');
      if (tpls.length) {
        items.push({ label: 'Eigene Vorlagen', header: true });
        for (const t of tpls) items.push({ label: t.name, action: () => replace(JSON.parse(JSON.stringify(t.layers)).map((l) => Object.assign(l, { id: FD.make(l.type).id }))) });
        items.push('-');
        for (const t of tpls) items.push({ label: `🗑 „${t.name}“ löschen`, action: async () => { if (await UI.confirm('Vorlage löschen?', `„${t.name}“ wird von diesem Rechner entfernt.`, 'Löschen')) UI.api('/api/cmd', { method: 'POST', body: JSON.stringify({ cmd: 'frame.template.delete', args: { id: t.id } }) }).catch((e) => UI.toast(e.message, 'err')); } });
      } else items.push({ label: 'Noch keine eigenen Vorlagen', disabled: true });
      UI.menu(anchor, items);
    };
    const replace = async (ls) => {
      if (layers.length && !(await UI.confirm('Rahmen ersetzen?', 'Die aktuellen Bausteine werden durch die Vorlage ersetzt.', 'Ersetzen'))) return;
      layers = ls; sel = layers[0] ? layers[0].id : null; emit(); render();
    };
    const saveTpl = async () => {
      if (!layers.length) return UI.toast('Noch keine Bausteine', 'warn');
      const name = await UI.prompt('Rahmen als Vorlage speichern', '', 'Name (gleicher Name überschreibt)');
      if (!name) return;
      UI.api('/api/cmd', { method: 'POST', body: JSON.stringify({ cmd: 'frame.template.save', args: { name, layers } }) }).then(() => UI.toast(`Vorlage „${name}“ gespeichert`, 'ok')).catch((e) => UI.toast(e.message, 'err'));
    };

    const addBtns = Object.entries(FD.BLOCKS).map(([type, b]) => h('button', { class: 'btn xs', title: b.label + ' hinzufügen', onclick: () => { const l = FD.make(type); layers.push(l); sel = l.id; emit(); render(); } }, `${b.icon} ${b.label}`));
    const root = h('div', { class: 'fb' },
      h('div', { class: 'fb-top' },
        h('div', { class: 'fb-prev' }, cv, h('div', { class: 'hint' }, 'Vorschau rund um den Kamerabereich. Bausteine passen sich automatisch an Position und Größe an.')),
        h('div', { class: 'fb-side' },
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', onclick: (e) => tplMenu(e.currentTarget) }, '📂 Vorlagen ▾'),
            h('button', { class: 'btn sm', onclick: saveTpl }, '💾 Als Vorlage speichern')),
          h('div', { class: 'fb-add' }, h('b', { class: 'hint' }, 'Baustein hinzufügen'), h('div', { class: 'row' }, addBtns)),
          list)),
      props);

    /* ---------- Bausteinliste ---------- */
    function renderList() {
      list.innerHTML = '';
      if (!layers.length) list.appendChild(h('div', { class: 'hint', style: { padding: '8px' } }, 'Noch leer – Baustein hinzufügen oder unter „Vorlagen“ ein Beispiel laden.'));
      // oberste Ebene zuerst anzeigen
      layers.slice().reverse().forEach((l) => {
        const i = layers.indexOf(l), b = FD.BLOCKS[l.type] || { icon: '?', label: l.type };
        const vis = h('input', { type: 'checkbox', checked: l.on !== false, title: 'Sichtbar', onclick: (e) => e.stopPropagation(), onchange: () => { l.on = vis.checked; emit(); renderList(); } });
        const sub = l.type === 'text' ? (l.text || '') : l.type === 'band' ? ((FD.BLOCKS.band.fields[0].options.find((o) => o[0] === l.pattern) || [])[1] || '') : l.type === 'shapes' ? ((FD.BLOCKS.shapes.fields[0].options.find((o) => o[0] === l.shape) || [])[1] || '') : '';
        list.appendChild(h('div', { class: 'fb-row' + (l.id === sel ? ' sel' : '') + (l.on === false ? ' off' : ''), onclick: () => { sel = l.id; render(); } },
          vis, h('span', { class: 'ic', style: { color: l.color && /^#/.test(l.color) ? l.color : '' } }, b.icon), h('span', { class: 'nm' }, b.label, sub ? h('i', null, ' · ' + sub) : null),
          h('button', { class: 'btn xs', title: 'Nach vorne', disabled: i === layers.length - 1, onclick: (e) => { e.stopPropagation(); [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; emit(); render(); } }, '↑'),
          h('button', { class: 'btn xs', title: 'Nach hinten', disabled: i === 0, onclick: (e) => { e.stopPropagation(); [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; emit(); render(); } }, '↓'),
          h('button', { class: 'btn xs', title: 'Duplizieren', onclick: (e) => { e.stopPropagation(); const c = Object.assign(JSON.parse(JSON.stringify(l)), { id: FD.make(l.type).id }); layers.splice(i + 1, 0, c); sel = c.id; emit(); render(); } }, '⧉'),
          h('button', { class: 'btn xs danger', title: 'Entfernen', onclick: (e) => { e.stopPropagation(); layers.splice(i, 1); if (sel === l.id) sel = layers[0] ? layers[0].id : null; emit(); render(); } }, '✕')));
      });
    }

    /* ---------- Einstellungen des gewählten Bausteins ---------- */
    function renderProps() {
      props.innerHTML = '';
      const l = cur(); if (!l) return;
      const b = FD.BLOCKS[l.type]; if (!b) return;
      const body = h('div', { class: 'fb-fields' });
      const fields = b.fields.concat([{ key: 'opacity', label: 'Deckkraft %', type: 'number', default: 100, min: 0, max: 100 }]);
      for (const f of fields) {
        // Bild: nur die Felder des gewählten Modus zeigen
        if (l.type === 'image' && ((l.mode === 'anchor' && ['slice', 'margin'].includes(f.key)) || (l.mode !== 'anchor' && ['anchor', 'size', 'dx', 'dy'].includes(f.key)) || (l.mode === 'stretch' && f.key === 'slice'))) continue;
        if (l.type === 'shapes' && f.key === 'width' && l.shape !== 'bracket') continue;
        const el = UI.field(Object.assign({}, f, { full: f.type === 'media' }), l[f.key], (v) => {
          l[f.key] = v; emit();
          if (['mode', 'shape', 'pattern', 'text', 'color'].includes(f.key)) { renderList(); if (['mode', 'shape'].includes(f.key)) renderProps(); }
        }, env);
        body.appendChild(el);
      }
      props.append(h('div', { class: 'fb-ph' }, `${b.icon} ${b.label}`), body);
    }

    function render() { renderList(); renderProps(); }

    /* ---------- Live-Vorschau ---------- */
    const fenv = (d) => ({
      sub: (t) => String(t).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => { const v = window.CueState && window.CueState.vars ? window.CueState.vars[k] : undefined; return v === undefined ? m : String(v); }),
      font: getComputedStyle(document.documentElement).getPropertyValue('--font-heading').trim() || 'sans-serif',
      values: { hp: d.hp, mp: d.mp },
      image: (src) => { if (!src) return null; const u = UI.mediaUrl(src); let im = imgs.get(u); if (!im) { im = new Image(); im.src = u; imgs.set(u, im); } return im; }
    });
    let mounted = false;
    const t0 = performance.now();
    function draw(now) {
      const d = getData() || {};
      const X = Number(d.x) || 0, Y = Number(d.y) || 0, W = Math.max(40, Number(d.w) || 600), H = Math.max(40, Number(d.h) || 400);
      // Ausschnitt: Kamerabereich plus Rand, im Seitenverhältnis 16:9
      let vw = W * 1.6, vh = H * 1.6;
      if (vw / vh > 16 / 9) vh = vw * 9 / 16; else vw = vh * 16 / 9;
      const s = cv.width / vw, ox = X + W / 2 - vw / 2, oy = Y + H / 2 - vh / 2;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = '#2a2f38'; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = '#323844'; for (let i = 0; i < cv.width; i += 24) for (let j = (i / 24) % 2 ? 24 : 0; j < cv.height; j += 48) x.fillRect(i, j, 24, 24);
      x.setTransform(s, 0, 0, s, -ox * s, -oy * s);
      const gr = x.createLinearGradient(X, Y, X + W, Y + H); gr.addColorStop(0, '#3b4a6b'); gr.addColorStop(1, '#6b4a5e');
      x.fillStyle = gr; x.fillRect(X, Y, W, H);
      x.fillStyle = 'rgba(255,255,255,.35)'; x.font = `600 ${Math.max(14, H / 10)}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Kamerabild', X + W / 2, Y + H / 2);
      x.textAlign = 'left';
      const e = fenv(d);
      FD.drawStatic(x, { X, Y, W, H }, layers, e);
      FD.drawAnimated(x, { X, Y, W, H }, layers, e, now - t0);
    }
    function loop(now) {
      if (!root.isConnected) {
        if (mounted || now - t0 > 5000) return;            // Editor geschlossen → Schleife endet
        requestAnimationFrame(loop); return;                // noch nicht eingehängt
      }
      mounted = true;
      if (!root.offsetParent) { setTimeout(() => requestAnimationFrame(loop), 400); return; } // ausgeblendet (anderer Look)
      try { draw(now); } catch (err) { console.error(err); }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    root.setValue = (v) => {
      const nv = Array.isArray(v) ? v : [];
      if (UI.isFocused(props) || JSON.stringify(nv) === JSON.stringify(layers)) return;
      layers = JSON.parse(JSON.stringify(nv));
      if (!layers.some((l) => l.id === sel)) sel = layers[0] ? layers[0].id : null;
      render();
    };
    render();
    return root;
  }

  window.CueFrameBuilder = FrameBuilder;
})();
