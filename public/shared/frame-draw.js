/* CueGFX – Eigene Kamerarahmen: Bausteine und Zeichnen (gemeinsam für Ausgabe und Builder-Vorschau)
 * Jeder Baustein bezieht sich auf den Kamerabereich (X, Y, W, H). „Abstand“ > 0 = außerhalb, < 0 = innerhalb. */
(function (root) {
  'use strict';

  const ANCHORS = [['tl', 'Oben links'], ['tc', 'Oben Mitte'], ['tr', 'Oben rechts'], ['ml', 'Links Mitte'], ['mr', 'Rechts Mitte'], ['bl', 'Unten links'], ['bc', 'Unten Mitte'], ['br', 'Unten rechts']];

  /* Baustein-Typen mit ihren Einstellungen (für den Builder) */
  const BLOCKS = {
    border: { label: 'Rand', icon: '▭', fields: [
      { key: 'color', label: 'Farbe', type: 'color', default: '#22e6ff' },
      { key: 'color2', label: 'Verlauf zu (optional)', type: 'color', default: '' },
      { key: 'width', label: 'Stärke', type: 'number', default: 8, min: 1, max: 200 },
      { key: 'offset', label: 'Abstand zum Bild', type: 'number', default: 4, min: -300, max: 300 },
      { key: 'radius', label: 'Eckenradius', type: 'number', default: 0, min: 0, max: 300 },
      { key: 'dash', label: 'Linie', type: 'select', options: [['solid', 'Durchgezogen'], ['dashed', 'Gestrichelt'], ['dotted', 'Gepunktet'], ['double', 'Doppelt']], default: 'solid' },
      { key: 'glow', label: 'Leuchten', type: 'number', default: 0, min: 0, max: 80 }] },
    band: { label: 'Muster-Band', icon: '▦', fields: [
      { key: 'pattern', label: 'Muster', type: 'select', options: [['solid', 'Einfarbig'], ['checker', 'Schachbrett'], ['stripes', 'Streifen'], ['blocks', 'Pixel-Blöcke'], ['dots', 'Punkte'], ['gradient', 'Verlauf']], default: 'checker' },
      { key: 'color', label: 'Farbe 1', type: 'color', default: '#111111' },
      { key: 'color2', label: 'Farbe 2', type: 'color', default: '#f5f5f5' },
      { key: 'width', label: 'Breite', type: 'number', default: 24, min: 2, max: 300 },
      { key: 'offset', label: 'Abstand zum Bild', type: 'number', default: 0, min: -300, max: 300 },
      { key: 'size', label: 'Mustergröße', type: 'number', default: 12, min: 2, max: 120 }] },
    shapes: { label: 'Ecken & Formen', icon: '◆', fields: [
      { key: 'shape', label: 'Form', type: 'select', options: [['bracket', 'Eckwinkel'], ['square', 'Quadrat'], ['circle', 'Kreis'], ['diamond', 'Raute'], ['star', 'Stern'], ['heart', 'Herz'], ['cross', 'Plus']], default: 'bracket' },
      { key: 'where', label: 'Position', type: 'select', options: [['corners', 'Ecken'], ['mids', 'Kantenmitten'], ['both', 'Ecken und Mitten'], ['top', 'Nur oben'], ['bottom', 'Nur unten']], default: 'corners' },
      { key: 'size', label: 'Größe', type: 'number', default: 60, min: 4, max: 400 },
      { key: 'width', label: 'Linienstärke (Eckwinkel)', type: 'number', default: 8, min: 1, max: 60 },
      { key: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
      { key: 'offset', label: 'Abstand zum Bild', type: 'number', default: 10, min: -300, max: 300 },
      { key: 'glow', label: 'Leuchten', type: 'number', default: 0, min: 0, max: 80 },
      { key: 'pulse', label: 'Pulsieren', type: 'toggle', default: false }] },
    text: { label: 'Text', icon: 'T', fields: [
      { key: 'text', label: 'Text (Variablen wie {{name}} gehen)', type: 'text', default: 'PLAYER 1' },
      { key: 'anchor', label: 'Position', type: 'select', options: ANCHORS, default: 'tl' },
      { key: 'dx', label: 'Versatz X', type: 'number', default: 0, min: -1000, max: 1000 },
      { key: 'dy', label: 'Versatz Y', type: 'number', default: -8, min: -1000, max: 1000 },
      { key: 'size', label: 'Schriftgröße', type: 'number', default: 36, min: 8, max: 300 },
      { key: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
      { key: 'bg', label: 'Hintergrund (optional)', type: 'color', default: '#111111' },
      { key: 'pad', label: 'Innenabstand', type: 'number', default: 14, min: 0, max: 100 },
      { key: 'pixel', label: 'Pixelschrift', type: 'toggle', default: false },
      { key: 'upper', label: 'Großbuchstaben', type: 'toggle', default: true },
      { key: 'glow', label: 'Leuchten', type: 'number', default: 0, min: 0, max: 80 }] },
    image: { label: 'Bild / PNG-Rahmen', icon: '🖼', fields: [
      { key: 'src', label: 'Bild (PNG mit Transparenz)', type: 'media', kind: 'image', default: '' },
      { key: 'mode', label: 'Anpassen', type: 'select', options: [['nine', '9-Teilung (Ecken bleiben scharf)'], ['stretch', 'Strecken'], ['anchor', 'Als Sticker an Position']], default: 'nine' },
      { key: 'slice', label: 'Eckgröße im Bild (px, 9-Teilung)', type: 'number', default: 40, min: 1, max: 1000 },
      { key: 'margin', label: 'Überstand nach außen', type: 'number', default: 30, min: -300, max: 600 },
      { key: 'anchor', label: 'Position (Sticker)', type: 'select', options: ANCHORS, default: 'tr' },
      { key: 'size', label: 'Breite (Sticker)', type: 'number', default: 160, min: 10, max: 1200 },
      { key: 'dx', label: 'Versatz X (Sticker)', type: 'number', default: 0, min: -1000, max: 1000 },
      { key: 'dy', label: 'Versatz Y (Sticker)', type: 'number', default: 0, min: -1000, max: 1000 }] },
    runner: { label: 'Lauflicht', icon: '✦', fields: [
      { key: 'color', label: 'Farbe', type: 'color', default: '#ffffff' },
      { key: 'width', label: 'Stärke', type: 'number', default: 4, min: 1, max: 60 },
      { key: 'length', label: 'Länge', type: 'number', default: 160, min: 10, max: 2000 },
      { key: 'speed', label: 'Tempo (px/s)', type: 'number', default: 400, min: -3000, max: 3000 },
      { key: 'count', label: 'Anzahl', type: 'number', default: 1, min: 1, max: 12 },
      { key: 'offset', label: 'Abstand zum Bild', type: 'number', default: 4, min: -300, max: 300 },
      { key: 'glow', label: 'Leuchten', type: 'number', default: 18, min: 0, max: 80 }] },
    bar: { label: 'Leiste (Leben/Energie)', icon: '▬', fields: [
      { key: 'value', label: 'Wert', type: 'select', options: [['hp', 'Leben'], ['mp', 'Energie']], default: 'hp' },
      { key: 'anchor', label: 'Position', type: 'select', options: ANCHORS, default: 'tr' },
      { key: 'dx', label: 'Versatz X', type: 'number', default: 0, min: -1000, max: 1000 },
      { key: 'dy', label: 'Versatz Y', type: 'number', default: -10, min: -1000, max: 1000 },
      { key: 'w', label: 'Breite', type: 'number', default: 260, min: 20, max: 1600 },
      { key: 'h', label: 'Höhe', type: 'number', default: 18, min: 4, max: 120 },
      { key: 'color', label: 'Farbe', type: 'color', default: '#e5283c' },
      { key: 'bg', label: 'Hintergrund', type: 'color', default: '#000000' },
      { key: 'segments', label: 'Segmente (0 = durchgehend)', type: 'number', default: 0, min: 0, max: 40 }] }
  };

  let seq = 0;
  const newId = () => 'f' + Date.now().toString(36) + (seq++);
  function make(type) {
    const l = { id: newId(), type, on: true, opacity: 100 };
    for (const f of BLOCKS[type].fields) l[f.key] = f.default;
    return l;
  }
  const L = (type, o) => Object.assign(make(type), o);

  /* Beispiele zum Loslegen */
  const STARTERS = [
    { name: 'Neon-Glühen', layers: () => [
      L('border', { color: '#ff2bd6', width: 6, offset: 18, radius: 18, glow: 30 }),
      L('border', { color: '#22e6ff', width: 4, offset: 4, radius: 8, glow: 18 }),
      L('runner', { color: '#ffffff', offset: 18, width: 5, length: 200, speed: 500, count: 2 }),
      L('text', { text: 'LIVE', anchor: 'tl', dy: -14, bg: '#ff2bd6', color: '#ffffff', size: 30, glow: 12 })] },
    { name: 'Zielflagge', layers: () => [
      L('band', { pattern: 'checker', color: '#111111', color2: '#f5f5f5', width: 28, offset: 0, size: 14 }),
      L('border', { color: '#e11d48', width: 6, offset: -3 }),
      L('text', { text: 'Mein Name', anchor: 'bl', dy: 12, bg: '#e11d48', size: 30 })] },
    { name: 'Pixel-Burg', layers: () => [
      L('band', { pattern: 'blocks', color: '#6b6b6b', color2: '#9a9a9a', width: 32, offset: 0, size: 8 }),
      L('shapes', { shape: 'square', where: 'both', size: 34, color: '#f5c542', offset: 16 }),
      L('text', { text: 'PLAYER 1', anchor: 'tc', dy: -40, pixel: true, bg: '#000000', size: 34 }),
      L('bar', { value: 'hp', anchor: 'br', dy: 40, w: 220, segments: 10 })] },
    { name: 'Gold-Ornament', layers: () => [
      L('band', { pattern: 'gradient', color: '#5b4a3a', color2: '#2b2119', width: 30, offset: 0 }),
      L('border', { color: '#f5d27a', color2: '#b8862b', width: 5, offset: 15, dash: 'double' }),
      L('shapes', { shape: 'diamond', where: 'corners', size: 34, color: '#e8b84a', offset: 15, glow: 10, pulse: true }),
      L('shapes', { shape: 'circle', where: 'mids', size: 14, color: '#c0182f', offset: 15 })] },
    { name: 'Minimal-HUD', layers: () => [
      L('shapes', { shape: 'bracket', where: 'corners', size: 90, width: 6, color: '#4cf2ff', offset: 14, glow: 14 }),
      L('border', { color: '#4cf2ff', width: 1, offset: 0, opacity: 45 }),
      L('text', { text: 'CAM 1', anchor: 'br', dy: 18, dx: -14, bg: '', color: '#4cf2ff', size: 22, glow: 10 })] }
  ];

  /* ---------- Hilfen ---------- */
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
  const grow = (g, o) => ({ x: g.X - o, y: g.Y - o, w: g.W + 2 * o, h: g.H + 2 * o });
  function rrPath(c, r, rad) {
    rad = Math.max(0, Math.min(rad, r.w / 2, r.h / 2));
    if (!rad) { c.rect(r.x, r.y, r.w, r.h); return; }
    c.moveTo(r.x + rad, r.y); c.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad); c.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
    c.arcTo(r.x, r.y + r.h, r.x, r.y, rad); c.arcTo(r.x, r.y, r.x + r.w, r.y, rad); c.closePath();
  }
  function anchorPt(g, a) {
    const xs = { l: g.X, c: g.X + g.W / 2, r: g.X + g.W }, ys = { t: g.Y, m: g.Y + g.H / 2, b: g.Y + g.H };
    return { x: xs[a[1]] !== undefined ? xs[a[1]] : xs.l, y: ys[a[0]] !== undefined ? ys[a[0]] : ys.t, h: a[1], v: a[0] };
  }
  /* Box an einem Anker platzieren: oben → über der Kante, unten → darunter, Mitte → zentriert */
  function placeBox(g, a, w, h, dx, dy) {
    const p = anchorPt(g, a || 'tl');
    let x = p.h === 'c' ? p.x - w / 2 : p.h === 'r' ? p.x - w : p.x;
    let y = p.v === 't' ? p.y - h : p.v === 'b' ? p.y : p.y - h / 2;
    if (p.v === 'm') x = p.h === 'l' ? p.x - w : p.h === 'r' ? p.x : x;
    return { x: x + dx, y: y + dy, w, h };
  }
  function pointsFor(g, where, o) {
    const r = grow(g, o), c = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
    const m = [[r.x + r.w / 2, r.y], [r.x + r.w, r.y + r.h / 2], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h / 2]];
    if (where === 'mids') return m;
    if (where === 'both') return c.concat(m);
    if (where === 'top') return [c[0], c[1], m[0]];
    if (where === 'bottom') return [c[2], c[3], m[2]];
    return c;
  }
  function perimeterPt(r, p) {
    const per = 2 * (r.w + r.h); p = ((p % per) + per) % per;
    if (p < r.w) return [r.x + p, r.y]; p -= r.w;
    if (p < r.h) return [r.x + r.w, r.y + p]; p -= r.h;
    if (p < r.w) return [r.x + r.w - p, r.y + r.h]; p -= r.w;
    return [r.x, r.y + r.h - p];
  }
  const pixCache = new Map();
  function pixelText(c, text, x, y, size, color) {
    const k = text + '|' + color;
    let cv = pixCache.get(k);
    if (!cv) {
      cv = document.createElement('canvas');
      const cx = cv.getContext('2d'); cx.font = '700 9px monospace';
      cv.width = Math.ceil(cx.measureText(text).width) + 2; cv.height = 12;
      cx.font = '700 9px monospace'; cx.textBaseline = 'top'; cx.fillStyle = color; cx.fillText(text, 1, 1);
      const im = cx.getImageData(0, 0, cv.width, cv.height);
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] > 110 ? 255 : 0;
      cx.putImageData(im, 0, 0);
      if (pixCache.size > 80) pixCache.clear();
      pixCache.set(k, cv);
    }
    const s = size / 9;
    c.imageSmoothingEnabled = false; c.drawImage(cv, x, y, cv.width * s, cv.height * s); c.imageSmoothingEnabled = true;
    return { w: cv.width * s, h: cv.height * s };
  }
  function shapePath(c, shape, s) {
    c.beginPath();
    if (shape === 'circle') c.arc(0, 0, s / 2, 0, Math.PI * 2);
    else if (shape === 'diamond') { c.moveTo(0, -s / 2); c.lineTo(s / 2, 0); c.lineTo(0, s / 2); c.lineTo(-s / 2, 0); c.closePath(); }
    else if (shape === 'star') { for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.2 : s / 2, a = i * Math.PI / 5 - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
    else if (shape === 'heart') { const k = s / 2; c.moveTo(0, k * 0.7); c.bezierCurveTo(-k * 2, -k * 0.5, -k * 0.9, -k * 1.9, 0, -k * 0.8); c.bezierCurveTo(k * 0.9, -k * 1.9, k * 2, -k * 0.5, 0, k * 0.7); c.closePath(); }
    else if (shape === 'cross') { const b = s / 3.2; c.rect(-s / 2, -b / 2, s, b); c.rect(-b / 2, -s / 2, b, s); }
    else c.rect(-s / 2, -s / 2, s, s);
  }

  /* ---------- Einzelne Bausteine zeichnen ---------- */
  function drawLayer(c, g, l, env, now) {
    const op = Math.max(0, Math.min(100, num(l.opacity, 100))) / 100;
    c.save(); c.globalAlpha = op;
    try {
      if (l.type === 'border') {
        const w = num(l.width, 8), o = num(l.offset, 0) + w / 2, r = grow(g, o);
        let stroke = l.color || '#fff';
        if (l.color2) { const gr = c.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h); gr.addColorStop(0, l.color || '#fff'); gr.addColorStop(1, l.color2); stroke = gr; }
        c.strokeStyle = stroke; c.lineJoin = 'round';
        if (num(l.glow, 0)) { c.shadowColor = l.color || '#fff'; c.shadowBlur = num(l.glow, 0); }
        if (l.dash === 'double') {
          const tw = Math.max(1, w / 3); c.lineWidth = tw;
          for (const k of [-1, 1]) { const rr = grow(g, o + k * tw); c.beginPath(); rrPath(c, rr, Math.max(0, num(l.radius, 0) + k * tw)); c.stroke(); }
        } else {
          c.lineWidth = w;
          if (l.dash === 'dashed') c.setLineDash([w * 3, w * 2]); else if (l.dash === 'dotted') { c.setLineDash([0.1, w * 2]); c.lineCap = 'round'; }
          c.beginPath(); rrPath(c, r, num(l.radius, 0)); c.stroke();
          if (num(l.glow, 0)) c.stroke();
        }
      } else if (l.type === 'band') {
        const w = num(l.width, 24), o = num(l.offset, 0), outer = grow(g, o + w), inner = grow(g, o);
        c.beginPath(); c.rect(outer.x, outer.y, outer.w, outer.h); c.rect(inner.x + inner.w, inner.y, -inner.w, inner.h); c.clip('evenodd');
        const c1 = l.color || '#111', c2 = l.color2 || '#eee', s = Math.max(2, num(l.size, 12));
        if (l.pattern === 'solid') { c.fillStyle = c1; c.fillRect(outer.x, outer.y, outer.w, outer.h); }
        else if (l.pattern === 'gradient') { const gr = c.createLinearGradient(0, outer.y, 0, outer.y + outer.h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); c.fillStyle = gr; c.fillRect(outer.x, outer.y, outer.w, outer.h); }
        else if (l.pattern === 'checker') { c.fillStyle = c2; c.fillRect(outer.x, outer.y, outer.w, outer.h); c.fillStyle = c1; for (let i = 0; i * s < outer.w; i++) for (let j = 0; j * s < outer.h; j++) if ((i + j) % 2) c.fillRect(outer.x + i * s, outer.y + j * s, s, s); }
        else if (l.pattern === 'stripes') { c.fillStyle = c1; c.fillRect(outer.x, outer.y, outer.w, outer.h); c.strokeStyle = c2; c.lineWidth = s / 2; c.beginPath(); for (let k = -outer.h; k < outer.w + outer.h; k += s) { c.moveTo(outer.x + k, outer.y); c.lineTo(outer.x + k + outer.h, outer.y + outer.h); } c.stroke(); }
        else if (l.pattern === 'dots') { c.fillStyle = c1; c.fillRect(outer.x, outer.y, outer.w, outer.h); c.fillStyle = c2; for (let i = 0; i * s < outer.w; i++) for (let j = 0; j * s < outer.h; j++) { c.beginPath(); c.arc(outer.x + i * s + s / 2, outer.y + j * s + s / 2, s * 0.28, 0, 6.3); c.fill(); } }
        else if (l.pattern === 'blocks') {
          let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
          const mix = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt((h || '#000000').replace('#', '').padEnd(6, '0').substr(i - 1, 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
          for (let i = 0; i * s < outer.w; i++) for (let j = 0; j * s < outer.h; j++) { c.fillStyle = mix(c1, c2, rnd()); c.fillRect(outer.x + i * s, outer.y + j * s, s + 0.5, s + 0.5); }
          c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = Math.max(1, s / 4); c.strokeRect(outer.x, outer.y, outer.w, outer.h); c.strokeRect(inner.x, inner.y, inner.w, inner.h);
        }
      } else if (l.type === 'shapes') {
        const s = num(l.size, 60), o = num(l.offset, 0);
        let alpha = 1;
        if (l.pulse && now) alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now / 1000 * 2.6));
        c.globalAlpha = op * alpha;
        c.fillStyle = c.strokeStyle = l.color || '#fff';
        if (num(l.glow, 0)) { c.shadowColor = l.color || '#fff'; c.shadowBlur = num(l.glow, 0); }
        if (l.shape === 'bracket') {
          const r = grow(g, o), lw = num(l.width, 8); c.lineWidth = lw; c.lineCap = 'square';
          const cs = [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]];
          const pick = l.where === 'top' ? cs.slice(0, 2) : l.where === 'bottom' ? cs.slice(2) : cs;
          for (const [x, y, sx, sy] of pick) { c.beginPath(); c.moveTo(x, y + sy * s); c.lineTo(x, y); c.lineTo(x + sx * s, y); c.stroke(); }
        } else {
          for (const [x, y] of pointsFor(g, l.where, o)) { c.save(); c.translate(x, y); shapePath(c, l.shape, s); c.fill(); c.restore(); }
        }
      } else if (l.type === 'text') {
        let text = env.sub ? env.sub(l.text || '') : (l.text || '');
        if (!text) return;
        if (l.upper) text = text.toUpperCase();
        const size = num(l.size, 36), pad = num(l.pad, 14);
        let tw, th;
        if (l.pixel) { const m = pixelText(c, text, -9999, -9999, size, l.color || '#fff'); tw = m.w; th = m.h; }
        else { c.font = `800 ${size}px ${env.font || 'sans-serif'}`; tw = c.measureText(text).width; th = size * 1.2; }
        const box = placeBox(g, l.anchor, tw + pad * 2, th + pad * (l.bg ? 1 : 0.4), num(l.dx, 0), num(l.dy, 0));
        if (l.bg) { c.fillStyle = l.bg; c.fillRect(box.x, box.y, box.w, box.h); }
        if (num(l.glow, 0)) { c.shadowColor = l.color || '#fff'; c.shadowBlur = num(l.glow, 0); }
        if (l.pixel) pixelText(c, text, box.x + pad, box.y + (box.h - th) / 2, size, l.color || '#fff');
        else { c.fillStyle = l.color || '#fff'; c.textBaseline = 'middle'; c.fillText(text, box.x + pad, box.y + box.h / 2 + size * 0.04); }
      } else if (l.type === 'image') {
        const img = env.image && env.image(l.src);
        if (!img || !img.complete || !img.naturalWidth) return;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        if (l.mode === 'anchor') {
          const w = num(l.size, 160), h = w * ih / iw;
          const b = placeBox(g, l.anchor, w, h, num(l.dx, 0), num(l.dy, 0)); c.drawImage(img, b.x, b.y, b.w, b.h);
        } else {
          const r = grow(g, num(l.margin, 30));
          if (l.mode === 'stretch') c.drawImage(img, r.x, r.y, r.w, r.h);
          else {
            const s = Math.max(1, Math.min(num(l.slice, 40), iw / 2 - 1, ih / 2 - 1)), d = Math.min(s, r.w / 2, r.h / 2);
            const sx = [0, s, iw - s, iw], sy = [0, s, ih - s, ih], dx = [r.x, r.x + d, r.x + r.w - d, r.x + r.w], dy = [r.y, r.y + d, r.y + r.h - d, r.y + r.h];
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
              if (i === 1 && j === 1) continue; // Mitte bleibt frei (Kamerabild)
              const w = sx[i + 1] - sx[i], h = sy[j + 1] - sy[j], W = dx[i + 1] - dx[i], H = dy[j + 1] - dy[j];
              if (w > 0 && h > 0 && W > 0 && H > 0) c.drawImage(img, sx[i], sy[j], w, h, dx[i], dy[j], W, H);
            }
          }
        }
      } else if (l.type === 'runner') {
        if (!now) return;
        const o = num(l.offset, 4), r = grow(g, o), per = 2 * (r.w + r.h), n = Math.max(1, Math.min(12, num(l.count, 1)));
        const len = Math.min(per / n, num(l.length, 160)), pos = (now / 1000) * num(l.speed, 400);
        c.strokeStyle = l.color || '#fff'; c.lineWidth = num(l.width, 4); c.lineCap = 'round'; c.lineJoin = 'round';
        if (num(l.glow, 0)) { c.shadowColor = l.color || '#fff'; c.shadowBlur = num(l.glow, 0); }
        for (let k = 0; k < n; k++) {
          const start = pos + k * per / n; c.beginPath();
          for (let i = 0; i <= 16; i++) { const [px, py] = perimeterPt(r, start + i * len / 16); i ? c.lineTo(px, py) : c.moveTo(px, py); }
          c.stroke();
        }
      } else if (l.type === 'bar') {
        const v = Math.max(0, Math.min(100, num(env.values && env.values[l.value || 'hp'], 100)));
        const b = placeBox(g, l.anchor, num(l.w, 260), num(l.h, 18), num(l.dx, 0), num(l.dy, 0));
        c.fillStyle = l.bg || '#000'; c.fillRect(b.x, b.y, b.w, b.h);
        const inW = (b.w - 4) * v / 100, segs = Math.max(0, Math.round(num(l.segments, 0)));
        c.fillStyle = l.color || '#e5283c';
        if (segs) { const sw = (b.w - 4) / segs; for (let i = 0; i < segs; i++) if ((i + 1) * sw <= inW + 0.5) c.fillRect(b.x + 2 + i * sw + 1, b.y + 2, sw - 2, b.h - 4); }
        else c.fillRect(b.x + 2, b.y + 2, inW, b.h - 4);
        c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(b.x + 2, b.y + 2, inW, Math.max(1, (b.h - 4) / 3));
        c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 2; c.strokeRect(b.x, b.y, b.w, b.h);
      }
    } finally { c.restore(); }
  }

  const isAnimated = (l) => l.type === 'runner' || (l.type === 'shapes' && l.pulse);

  /* Unbewegte Bausteine (einmal pro Änderung) bzw. bewegte (jedes Bild) */
  function drawStatic(c, g, layers, env) { for (const l of layers || []) if (l && l.on !== false && BLOCKS[l.type] && !isAnimated(l)) drawLayer(c, g, l, env, 0); }
  function drawAnimated(c, g, layers, env, now) { for (const l of layers || []) if (l && l.on !== false && BLOCKS[l.type] && isAnimated(l)) drawLayer(c, g, l, env, now); }
  const hasAnimated = (layers) => (layers || []).some((l) => l && l.on !== false && isAnimated(l));

  root.CueFrameDraw = { BLOCKS, STARTERS, ANCHORS, make, drawStatic, drawAnimated, hasAnimated, drawLayer };
})(typeof self !== 'undefined' ? self : this);
