/* CueGFX – UI-Helfer: Elemente, Dialoge, Menüs, Toasts und schemabasierte Formularfelder */
(function () {
  'use strict';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; };

  function toast(msg, kind) {
    const wrap = document.getElementById('toasts');
    const t = h('div', { class: 'toast ' + (kind || '') }, msg);
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 2600);
  }

  function modal(title, body, opts = {}) {
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: 'modal', style: opts.width ? { width: `min(${opts.width}px, 100%)` } : null },
      h('div', { class: 'mh' }, h('h2', null, title), ...(opts.actions || []), h('button', { class: 'btn ghost', onclick: close, title: 'Schließen' }, '✕')),
      h('div', { class: 'mb' }, body));
    const bg = h('div', { class: 'modal-bg', onmousedown: (e) => { if (e.target === bg) close(); } }, box);
    document.body.appendChild(bg);
    document.addEventListener('keydown', onKey);
    const first = box.querySelector('input,textarea,select');
    if (first && opts.focus !== false) setTimeout(() => first.focus(), 30);
    return { close, el: box };
  }

  function prompt(title, value, label) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'text', class: 'inp', value: value || '' });
      let done = false;
      const ok = () => { done = true; m.close(); resolve(inp.value); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      const m = modal(title, h('div', { class: 'field' }, label ? h('label', null, label) : null, inp,
        h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: ok }, 'OK'))),
      { width: 440, onClose: () => { if (!done) resolve(null); } });
      setTimeout(() => inp.select(), 40);
    });
  }

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal(title, h('div', null, h('p', { style: { marginTop: 0 } }, text),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: () => { done = true; m.close(); resolve(false); } }, 'Abbrechen'),
          h('button', { class: 'btn primary', onclick: () => { done = true; m.close(); resolve(true); } }, okLabel || 'OK'))),
      { width: 440, focus: false, onClose: () => { if (!done) resolve(false); } });
    });
  }

  function menu(anchor, items) {
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    const m = h('div', { class: 'menu' }, items.map((it) => it === '-' ? h('hr') :
      h('button', { class: it.cur ? 'cur' : '', onclick: () => { m.remove(); it.action(); } }, it.label)));
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
    return m;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((body && body.error) || res.statusText);
    return body;
  }

  function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', '/api/media?name=' + encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => { try { const r = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(r) : reject(new Error(r.error)); } catch (e) { reject(e); } };
      xhr.onerror = () => reject(new Error('Upload fehlgeschlagen'));
      xhr.send(file);
    });
  }

  function copyText(text) {
    const done = () => toast('In die Zwischenablage kopiert', 'ok');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (_) { toast(text); }
      ta.remove();
    }
  }

  /* ---------- Schemabasierte Felder ---------- */
  const isFocused = (el) => el && (el === document.activeElement || el.contains(document.activeElement));
  /* true nur, wenn gerade in einem Eingabefeld getippt/ausgewählt wird – Buttons & Checkboxen zählen nicht */
  const NON_TEXT = /^(button|submit|reset|checkbox|radio|file|image|color)$/i;
  const isEditing = (el) => {
    const a = document.activeElement;
    if (!el || !a || !(a === el || el.contains(a))) return false;
    if (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    return a.tagName === 'INPUT' && !NON_TEXT.test(a.type || 'text');
  };
  /* Auswahlfelder & Checkboxen nach der Änderung freigeben, damit die Ansicht sofort aktualisiert */
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && /^(checkbox|radio|color|range|file)$/i.test(t.type)))) setTimeout(() => { if (document.activeElement === t) t.blur(); }, 0);
  }, true);
  /* Während eine Maustaste/ein Finger gedrückt ist, nicht neu zeichnen – sonst verschwindet der Button unter dem Klick */
  let pressed = false; const afterPress = [];
  document.addEventListener('pointerdown', () => { pressed = true; }, true);
  const release = () => { if (!pressed) return; setTimeout(() => { pressed = false; const fns = afterPress.splice(0); for (const fn of new Set(fns)) { try { fn(); } catch (err) { console.error(err); } } }, 0); };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);
  const whenReleased = (fn) => { if (!pressed) return true; if (!afterPress.includes(fn)) afterPress.push(fn); return false; };
  const mediaUrl = (v) => !v ? '' : /^(https?:|data:|\/)/.test(v) ? v : '/media/' + encodeURIComponent(v);

  function field(def, value, onChange, env) {
    const wrap = h('div', { class: 'field' + (['textarea', 'code', 'list', 'builder'].includes(def.type) || def.full ? ' full' : '') });
    const label = h('label', null, def.label);
    let input, setValue;
    switch (def.type) {
      case 'text': {
        input = h('input', { type: 'text', value: value === undefined ? '' : value, oninput: () => onChange(input.value), placeholder: def.placeholder });
        setValue = (v) => { if (!isFocused(input) && input.value !== String(v === undefined ? '' : v)) input.value = v === undefined ? '' : v; };
        wrap.append(label, input);
        break;
      }
      case 'textarea': case 'code': {
        input = h('textarea', { rows: def.rows || (def.type === 'code' ? 6 : 3), class: def.type === 'code' ? 'code' : '', spellcheck: def.type === 'code' ? 'false' : 'true', oninput: () => onChange(input.value) });
        input.value = value || '';
        if (def.type === 'code') input.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = input.selectionStart; input.setRangeText('  ', s, input.selectionEnd, 'end'); onChange(input.value); } });
        setValue = (v) => { if (!isFocused(input) && input.value !== (v || '')) input.value = v || ''; };
        wrap.append(label, input);
        break;
      }
      case 'number': {
        input = h('input', { type: 'number', value: value, min: def.min, max: def.max, step: def.step || 'any', oninput: () => { if (input.value !== '') onChange(Number(input.value)); } });
        setValue = (v) => { if (!isFocused(input) && Number(input.value) !== Number(v)) input.value = v; };
        wrap.append(label, input);
        break;
      }
      case 'select': {
        input = h('select', { onchange: () => onChange(input.value) }, def.options.map(([v, l]) => h('option', { value: v }, l)));
        const setSel = (v) => { input.value = v === undefined || v === null ? '' : String(v); if (input.selectedIndex < 0 && input.options.length) input.selectedIndex = 0; };
        setSel(value);
        setValue = (v) => { if (!isFocused(input)) setSel(v); };
        wrap.append(label, input);
        break;
      }
      case 'toggle': {
        input = h('input', { type: 'checkbox', checked: !!value, onchange: () => onChange(input.checked) });
        setValue = (v) => { input.checked = !!v; };
        wrap.append(h('label', { class: 'switch', style: { marginTop: '18px' } }, input, def.label));
        break;
      }
      case 'color': {
        const isEmpty = (v) => !v;
        const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff' });
        const txt = h('input', { type: 'text', value: value || '', placeholder: def.allowEmpty ? 'Theme' : '#rrggbb' });
        pick.addEventListener('input', () => { txt.value = pick.value; onChange(pick.value); });
        txt.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(txt.value)) pick.value = txt.value; onChange(txt.value.trim()); });
        const reset = def.allowEmpty ? h('button', { class: 'btn xs', title: 'Theme-Farbe verwenden', onclick: () => { txt.value = ''; onChange(''); } }, 'Theme') : null;
        setValue = (v) => { if (!isFocused(txt) && !isFocused(pick)) { txt.value = v || ''; if (/^#[0-9a-f]{6}$/i.test(v)) pick.value = v; } };
        input = txt;
        wrap.append(label, h('div', { class: 'colorf' }, pick, txt, reset));
        void isEmpty;
        break;
      }
      case 'media': {
        const sel = h('select');
        const thumb = h('div', { class: 'thumb' });
        const fill = (v) => {
          const list = (env.media() || []).filter((m) => !def.kind || m.kind === def.kind);
          sel.innerHTML = '';
          sel.appendChild(h('option', { value: '' }, '— keine —'));
          for (const m of list) sel.appendChild(h('option', { value: m.name }, m.name));
          if (v && !list.find((m) => m.name === v)) sel.appendChild(h('option', { value: v }, v));
          sel.value = v || '';
          thumb.style.backgroundImage = def.kind === 'image' && v ? `url("${mediaUrl(v)}")` : '';
          thumb.textContent = def.kind !== 'image' && v ? (def.kind === 'video' ? '🎬' : '🔊') : '';
          thumb.style.display = def.kind === 'image' || v ? '' : 'none';
        };
        fill(value);
        sel.addEventListener('change', () => { onChange(sel.value); fill(sel.value); });
        const file = h('input', { type: 'file', accept: def.kind === 'image' ? 'image/*' : def.kind === 'video' ? 'video/mp4,video/webm,video/*' : def.kind === 'audio' ? 'audio/*' : '*/*', style: { display: 'none' } });
        file.addEventListener('change', async () => {
          const f = file.files[0]; if (!f) return;
          toast('Lade hoch: ' + f.name);
          try { const r = await uploadFile(f); await env.reloadMedia(); onChange(r.name); fill(r.name); toast('Hochgeladen', 'ok'); } catch (e) { toast(e.message, 'err'); }
          file.value = '';
        });
        const url = h('button', { class: 'btn sm', title: 'Externe URL', onclick: async () => { const u = await UI.prompt('Bild-/Medien-URL', /^https?:/.test(sel.value) ? sel.value : 'https://'); if (u) { onChange(u); fill(u); } } }, 'URL');
        setValue = (v) => { if (!isFocused(sel)) fill(v); };
        env.onMediaChange && env.onMediaChange(() => fill(sel.value));
        input = sel;
        wrap.append(label, h('div', { class: 'mediaf' }, thumb, sel, h('button', { class: 'btn sm', onclick: () => file.click() }, 'Hochladen'), url, file));
        break;
      }
      case 'poll': {
        input = h('select', { onchange: () => onChange(input.value) });
        const fill = (v) => {
          input.innerHTML = '';
          input.appendChild(h('option', { value: '' }, '— erste Umfrage —'));
          for (const p of env.polls()) input.appendChild(h('option', { value: p.id }, p.question));
          input.value = v || '';
        };
        fill(value);
        setValue = (v) => { if (!isFocused(input)) fill(v); };
        wrap.append(label, input);
        break;
      }
      case 'list': {
        const box = h('div', { class: 'listf' });
        let items = JSON.parse(JSON.stringify(value || []));
        const emit = () => onChange(JSON.parse(JSON.stringify(items)));
        const render = () => {
          box.innerHTML = '';
          items.forEach((it, i) => {
            const sub = h('div', { class: 'sub' }, def.fields.map((sf) => {
              const f = field(Object.assign({}, sf, { full: false }), it[sf.key], (v) => { items[i][sf.key] = v; emit(); }, env);
              if (sf.type === 'textarea') f.style.gridColumn = '1 / -1';
              return f;
            }));
            const ops = h('div', { class: 'ops' },
              h('button', { class: 'btn xs', title: 'Nach oben', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; emit(); render(); } }, '↑'),
              h('button', { class: 'btn xs', title: 'Nach unten', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; emit(); render(); } }, '↓'),
              h('button', { class: 'btn xs danger', title: 'Entfernen', onclick: () => { items.splice(i, 1); emit(); render(); } }, '✕'));
            box.appendChild(h('div', { class: 'li' }, sub, ops));
          });
          box.appendChild(h('div', { class: 'row' },
            h('button', { class: 'btn sm', onclick: () => { const n = {}; def.fields.forEach((sf) => { n[sf.key] = sf.default || ''; }); items.push(n); emit(); render(); const ins = box.querySelectorAll('.li'); const last = ins[ins.length - 1]; last && last.querySelector('input,textarea') && last.querySelector('input,textarea').focus(); } }, '+ ' + (def.itemLabel || 'Eintrag')),
            def.fields.length === 1 ? h('button', { class: 'btn sm', onclick: async () => {
              const ta = h('textarea', { rows: 10, class: 'inp' }); ta.value = items.map((x) => x[def.fields[0].key]).join('\n');
              const m = UI.modal('Als Text bearbeiten (eine Zeile pro Eintrag)', h('div', null, ta, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } },
                h('button', { class: 'btn primary', onclick: () => { items = ta.value.split('\n').filter((s) => s.trim()).map((s) => ({ [def.fields[0].key]: s })); emit(); render(); m.close(); } }, 'Übernehmen'))), { width: 640 });
            } }, 'Als Text') : null));
        };
        render();
        setValue = (v) => { if (!isFocused(box) && JSON.stringify(v || []) !== JSON.stringify(items)) { items = JSON.parse(JSON.stringify(v || [])); render(); } };
        wrap.append(label, box);
        input = box;
        break;
      }
      default:
        wrap.append(label, h('div', { class: 'hint' }, '(' + def.type + ')'));
        setValue = () => {};
    }
    wrap.setValue = setValue;
    wrap.def = def;
    return wrap;
  }

  window.UI = { h, debounce, toast, modal, prompt, confirm: confirmBox, menu, api, uploadFile, copyText, field, isFocused, isEditing, whenReleased, mediaUrl };
})();
