/* CueGFX – Grafiktyp-Definitionen (gemeinsam für Server, Steuerung und Output) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CueTypes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POSITIONS = [
    ['top-left', 'Oben links'], ['top-center', 'Oben Mitte'], ['top-right', 'Oben rechts'],
    ['middle-left', 'Mitte links'], ['center', 'Mitte'], ['middle-right', 'Mitte rechts'],
    ['bottom-left', 'Unten links'], ['bottom-center', 'Unten Mitte'], ['bottom-right', 'Unten rechts']
  ];
  const ANIMATIONS = [
    ['theme', 'Wie Theme'], ['slide', 'Slide'], ['slide-up', 'Slide hoch'], ['fade', 'Fade'],
    ['wipe', 'Wipe'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['none', 'Cut (keine)']
  ];
  const TIMER_FORMATS = [['auto', 'Automatisch'], ['mm:ss', 'mm:ss'], ['hh:mm:ss', 'hh:mm:ss'], ['ss', 'Sekunden']];

  const defaultTimer = (seconds, mode) => ({ duration: seconds, mode: mode || 'down', running: false, startedAt: 0, elapsedBefore: 0 });

  const commonPositioned = (pos) => [
    { key: 'position', label: 'Position', type: 'select', options: POSITIONS, default: pos || 'bottom-left', group: 'Layout' },
    { key: 'offsetX', label: 'Versatz X', type: 'number', default: 0, step: 1, group: 'Layout' },
    { key: 'offsetY', label: 'Versatz Y', type: 'number', default: 0, step: 1, group: 'Layout' },
    { key: 'scale', label: 'Skalierung %', type: 'number', default: 100, min: 10, max: 400, step: 5, group: 'Layout' }
  ];
  const commonAll = [
    { key: 'animation', label: 'Animation', type: 'select', options: ANIMATIONS, default: 'theme', group: 'Erweitert' },
    { key: 'autoHide', label: 'Automatisch ausblenden nach (s, 0 = nie)', type: 'number', default: 0, min: 0, group: 'Erweitert' },
    { key: 'css', label: 'Eigenes CSS (gilt nur für diese Grafik, Selektor: & )', type: 'code', default: '', group: 'Erweitert' }
  ];

  const T = {};
  const def = (type, o) => { T[type] = Object.assign({ type, pro: false, fullscreen: false, controls: [] }, o); };

  def('lowerthird', {
    label: 'Bauchbinde', icon: '▭', category: 'Text',
    fields: [
      { key: 'name', label: 'Name', type: 'text', default: 'Max Mustermann' },
      { key: 'title', label: 'Titel', type: 'text', default: 'Moderation' },
      { key: 'style', label: 'Stil', type: 'select', options: [['box', 'Box'], ['split', 'Geteilt'], ['underline', 'Unterstrich'], ['minimal', 'Minimal'], ['pill', 'Pill']], default: 'box' },
      { key: 'align', label: 'Textausrichtung', type: 'select', options: [['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']], default: 'left' },
      { key: 'logo', label: 'Logo', type: 'media', kind: 'image', default: '' },
      { key: 'color1', label: 'Farbe Name (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      { key: 'color2', label: 'Farbe Titel (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      ...commonPositioned('bottom-left')
    ]
  });

  def('lowerthird_anim', {
    label: 'Animierte Bauchbinde', icon: '▰', category: 'Text', pro: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', default: 'Erika Musterfrau' },
      { key: 'title', label: 'Titel', type: 'text', default: 'Redaktion' },
      { key: 'style', label: 'Animationsstil', type: 'select', options: [['reveal', 'Reveal'], ['bar', 'Wachsender Balken'], ['stagger', 'Gestaffelt'], ['glow', 'Glow'], ['flip', '3D-Flip']], default: 'reveal' },
      { key: 'accent', label: 'Akzentfarbe (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      { key: 'logo', label: 'Logo', type: 'media', kind: 'image', default: '' },
      ...commonPositioned('bottom-left')
    ]
  });

  def('message', {
    label: 'Nachricht', icon: '✉', category: 'Text',
    fields: [
      { key: 'heading', label: 'Überschrift', type: 'text', default: 'Hallo!' },
      { key: 'body', label: 'Text', type: 'textarea', default: 'Willkommen in der Sendung, schön dass du dabei bist!' },
      { key: 'style', label: 'Stil', type: 'select', options: [['card', 'Karte'], ['banner', 'Banner'], ['bubble', 'Sprechblase'], ['plain', 'Nur Text']], default: 'card' },
      { key: 'width', label: 'Breite (px)', type: 'number', default: 900, min: 200, max: 1920 },
      ...commonPositioned('bottom-center')
    ]
  });

  def('ticker', {
    label: 'Ticker', icon: '⇆', category: 'Text', fullscreen: true,
    fields: [
      { key: 'label', label: 'Label', type: 'text', default: 'NEWS' },
      { key: 'items', label: 'Meldungen', type: 'list', itemLabel: 'Meldung', fields: [{ key: 'text', label: 'Text', type: 'text', default: '' }], default: [{ text: 'Erste Meldung im Ticker' }, { text: 'Zweite Meldung – {{time}}' }] },
      { key: 'separator', label: 'Trenner', type: 'text', default: '•' },
      { key: 'speed', label: 'Geschwindigkeit (px/s)', type: 'number', default: 120, min: 10, max: 1000 },
      { key: 'mode', label: 'Modus', type: 'select', options: [['scroll', 'Laufband'], ['flip', 'Einzeln blättern']], default: 'scroll' },
      { key: 'flipSeconds', label: 'Blättern alle (s)', type: 'number', default: 6, min: 1, showIf: { mode: 'flip' } },
      { key: 'placement', label: 'Platzierung', type: 'select', options: [['bottom', 'Unten'], ['top', 'Oben']], default: 'bottom' },
      { key: 'margin', label: 'Abstand vom Rand (px)', type: 'number', default: 0, min: 0 }
    ]
  });

  def('social', {
    label: 'Social / Chat', icon: '💬', category: 'Text',
    fields: [
      { key: 'platform', label: 'Plattform', type: 'select', options: [['twitch', 'Twitch'], ['youtube', 'YouTube'], ['instagram', 'Instagram'], ['x', 'X'], ['facebook', 'Facebook'], ['custom', 'Sonstige']], default: 'twitch' },
      { key: 'author', label: 'Name', type: 'text', default: 'zuschauer42' },
      { key: 'message', label: 'Nachricht', type: 'textarea', default: 'Grüße aus Stuttgart! 👋' },
      { key: 'avatar', label: 'Avatar', type: 'media', kind: 'image', default: '' },
      { key: 'color', label: 'Namensfarbe (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      ...commonPositioned('bottom-left')
    ]
  });

  def('image', {
    label: 'Bild', icon: '🖼', category: 'Medien',
    fields: [
      { key: 'src', label: 'Bild', type: 'media', kind: 'image', default: '' },
      { key: 'width', label: 'Breite (px, 0 = original)', type: 'number', default: 400, min: 0 },
      { key: 'height', label: 'Höhe (px, 0 = automatisch)', type: 'number', default: 0, min: 0 },
      { key: 'fit', label: 'Einpassen', type: 'select', options: [['contain', 'Enthalten'], ['cover', 'Füllen'], ['fill', 'Strecken']], default: 'contain' },
      { key: 'opacity', label: 'Deckkraft %', type: 'number', default: 100, min: 0, max: 100 },
      { key: 'radius', label: 'Eckenradius (px)', type: 'number', default: 0, min: 0 },
      { key: 'fullscreen', label: 'Vollbild', type: 'toggle', default: false },
      ...commonPositioned('top-right')
    ]
  });

  def('video', {
    label: 'Video', icon: '🎬', category: 'Medien', pro: true,
    fields: [
      { key: 'src', label: 'Video (MP4/WebM)', type: 'media', kind: 'video', default: '' },
      { key: 'fullscreen', label: 'Vollbild', type: 'toggle', default: true },
      { key: 'width', label: 'Breite (px, wenn nicht Vollbild)', type: 'number', default: 640, min: 0, showIf: { fullscreen: false } },
      { key: 'fit', label: 'Einpassen', type: 'select', options: [['contain', 'Enthalten'], ['cover', 'Füllen']], default: 'cover' },
      { key: 'loop', label: 'Schleife', type: 'toggle', default: false },
      { key: 'muted', label: 'Stumm', type: 'toggle', default: false },
      { key: 'volume', label: 'Lautstärke %', type: 'number', default: 100, min: 0, max: 100 },
      { key: 'trimStart', label: 'Start ab (s)', type: 'number', default: 0, min: 0, step: 0.1 },
      { key: 'trimEnd', label: 'Ende bei (s, 0 = Dateiende)', type: 'number', default: 0, min: 0, step: 0.1 },
      { key: 'hideOnEnd', label: 'Am Ende automatisch ausblenden', type: 'toggle', default: true },
      ...commonPositioned('center')
    ]
  });

  def('audio', {
    label: 'Audio', icon: '🔊', category: 'Medien', pro: true,
    fields: [
      { key: 'src', label: 'Audio (MP3/WAV)', type: 'media', kind: 'audio', default: '' },
      { key: 'loop', label: 'Schleife', type: 'toggle', default: false },
      { key: 'volume', label: 'Lautstärke %', type: 'number', default: 100, min: 0, max: 100 },
      { key: 'trimStart', label: 'Start ab (s)', type: 'number', default: 0, min: 0, step: 0.1 },
      { key: 'trimEnd', label: 'Ende bei (s, 0 = Dateiende)', type: 'number', default: 0, min: 0, step: 0.1 },
      { key: 'fadeIn', label: 'Einblenden (s)', type: 'number', default: 0, min: 0, step: 0.1 },
      { key: 'hideOnEnd', label: 'Am Ende automatisch stoppen', type: 'toggle', default: true }
    ]
  });

  def('score', {
    label: 'Spielstand', icon: '🏆', category: 'Sport',
    controls: ['score', 'timer'],
    fields: [
      { key: 'teamA', label: 'Team A', type: 'text', default: 'Heim' },
      { key: 'teamB', label: 'Team B', type: 'text', default: 'Gast' },
      { key: 'scoreA', label: 'Punkte A', type: 'number', default: 0 },
      { key: 'scoreB', label: 'Punkte B', type: 'number', default: 0 },
      { key: 'colorA', label: 'Farbe A', type: 'color', default: '#d62839' },
      { key: 'colorB', label: 'Farbe B', type: 'color', default: '#1d4ed8' },
      { key: 'logoA', label: 'Logo A', type: 'media', kind: 'image', default: '' },
      { key: 'logoB', label: 'Logo B', type: 'media', kind: 'image', default: '' },
      { key: 'period', label: 'Abschnitt / Info', type: 'text', default: '1. HZ' },
      { key: 'style', label: 'Stil', type: 'select', options: [['bar', 'Leiste'], ['boxes', 'Boxen'], ['compact', 'Kompakt']], default: 'bar' },
      { key: 'showClock', label: 'Spieluhr anzeigen', type: 'toggle', default: true },
      { key: 'timer', label: 'Spieluhr', type: 'timer', default: defaultTimer(45 * 60, 'up') },
      { key: 'format', label: 'Uhrformat', type: 'select', options: TIMER_FORMATS, default: 'mm:ss' },
      ...commonPositioned('top-left')
    ]
  });

  def('timer', {
    label: 'Timer', icon: '⏱', category: 'Zeit',
    controls: ['timer'],
    fields: [
      { key: 'label', label: 'Beschriftung', type: 'text', default: 'Countdown' },
      { key: 'timer', label: 'Timer', type: 'timer', default: defaultTimer(300, 'down') },
      { key: 'format', label: 'Format', type: 'select', options: TIMER_FORMATS, default: 'auto' },
      { key: 'allowOverrun', label: 'Überziehen anzeigen (negativ)', type: 'toggle', default: true },
      { key: 'endText', label: 'Text bei 0 (leer = 00:00)', type: 'text', default: '' },
      ...commonPositioned('top-right')
    ]
  });

  def('bigtimer', {
    label: 'Großer Timer', icon: '⏲', category: 'Zeit', pro: true, fullscreen: true,
    controls: ['timer'],
    fields: [
      { key: 'label', label: 'Beschriftung', type: 'text', default: 'Wir starten in' },
      { key: 'timer', label: 'Timer', type: 'timer', default: defaultTimer(600, 'down') },
      { key: 'format', label: 'Format', type: 'select', options: TIMER_FORMATS, default: 'auto' },
      { key: 'warnAt', label: 'Warnung ab (s)', type: 'number', default: 60, min: 0 },
      { key: 'dangerAt', label: 'Kritisch ab (s)', type: 'number', default: 10, min: 0 },
      { key: 'allowOverrun', label: 'Überziehen anzeigen', type: 'toggle', default: false },
      { key: 'background', label: 'Hintergrund', type: 'select', options: [['none', 'Transparent'], ['theme', 'Theme'], ['black', 'Schwarz']], default: 'theme' },
      { key: 'progress', label: 'Fortschrittsbalken', type: 'toggle', default: true }
    ]
  });

  def('speakertimer', {
    label: 'Sprecher-Timer', icon: '🎤', category: 'Utility', pro: true, fullscreen: true,
    controls: ['timer'],
    fields: [
      { key: 'speaker', label: 'Sprecher:in', type: 'text', default: '' },
      { key: 'timer', label: 'Timer', type: 'timer', default: defaultTimer(900, 'down') },
      { key: 'format', label: 'Format', type: 'select', options: TIMER_FORMATS, default: 'auto' },
      { key: 'warnAt', label: 'Gelb ab (s)', type: 'number', default: 120, min: 0 },
      { key: 'dangerAt', label: 'Rot ab (s)', type: 'number', default: 30, min: 0 },
      { key: 'note', label: 'Nachricht an Sprecher:in', type: 'text', default: '' },
      { key: 'flashNote', label: 'Nachricht blinkt', type: 'toggle', default: true },
      { key: 'showClock', label: 'Uhrzeit anzeigen', type: 'toggle', default: true },
      { key: 'progress', label: 'Fortschrittsbalken', type: 'toggle', default: true }
    ]
  });

  def('timeofday', {
    label: 'Uhrzeit', icon: '🕒', category: 'Utility', pro: true,
    fields: [
      { key: 'label', label: 'Beschriftung', type: 'text', default: '' },
      { key: 'hour12', label: '12-Stunden-Format', type: 'toggle', default: false },
      { key: 'seconds', label: 'Sekunden', type: 'toggle', default: true },
      { key: 'showDate', label: 'Datum', type: 'toggle', default: false },
      { key: 'timezone', label: 'Zeitzone (IANA, leer = lokal)', type: 'text', default: '' },
      { key: 'style', label: 'Stil', type: 'select', options: [['box', 'Box'], ['plain', 'Nur Text'], ['big', 'Groß/Vollbild']], default: 'box' },
      ...commonPositioned('top-right')
    ]
  });

  def('testpattern', {
    label: 'Testbild', icon: '▦', category: 'Utility', pro: true, fullscreen: true,
    fields: [
      { key: 'pattern', label: 'Muster', type: 'select', options: [['smpte', 'SMPTE-Farbbalken'], ['ebu', 'EBU-Farbbalken'], ['grid', 'Raster'], ['safe', 'Sicherheitsbereiche'], ['gradient', 'Graustufen-Verlauf'], ['checker', 'Schachbrett (Alpha-Test)'], ['color', 'Vollfarbe']], default: 'smpte' },
      { key: 'color', label: 'Farbe (Vollfarbe)', type: 'color', default: '#ff0000', showIf: { pattern: 'color' } },
      { key: 'ident', label: 'Kennung', type: 'text', default: 'CueGFX' },
      { key: 'showInfo', label: 'Info & Uhrzeit einblenden', type: 'toggle', default: true },
      { key: 'tone', label: '1-kHz-Testton', type: 'toggle', default: false }
    ]
  });

  def('credits', {
    label: 'Abspann', icon: '📜', category: 'Text', pro: true, fullscreen: true,
    fields: [
      { key: 'heading', label: 'Überschrift', type: 'text', default: 'Danke an' },
      { key: 'entries', label: 'Einträge', type: 'list', itemLabel: 'Eintrag', fields: [{ key: 'role', label: 'Rolle', type: 'text', default: '' }, { key: 'names', label: 'Namen (eine pro Zeile)', type: 'textarea', default: '' }], default: [{ role: 'Regie', names: 'Anna Beispiel' }, { role: 'Kamera', names: 'Ben Muster\nCarla Probe' }, { role: 'Grafik', names: 'CueGFX' }] },
      { key: 'speed', label: 'Geschwindigkeit (px/s)', type: 'number', default: 80, min: 5, max: 1000 },
      { key: 'loop', label: 'Wiederholen', type: 'toggle', default: false },
      { key: 'background', label: 'Hintergrund', type: 'select', options: [['none', 'Transparent'], ['dim', 'Abgedunkelt'], ['theme', 'Theme']], default: 'dim' },
      { key: 'hideOnEnd', label: 'Am Ende ausblenden', type: 'toggle', default: true }
    ]
  });

  def('lyrics', {
    label: 'Songtexte', icon: '🎵', category: 'Text', pro: true,
    controls: ['step'],
    fields: [
      { key: 'song', label: 'Titel', type: 'text', default: 'Lied' },
      { key: 'text', label: 'Text (Folien durch Leerzeile trennen)', type: 'textarea', rows: 10, default: 'Erste Zeile\nZweite Zeile\n\nDritte Zeile\nVierte Zeile' },
      { key: 'index', label: 'Aktuelle Folie', type: 'number', default: 0, min: 0, hidden: true },
      { key: 'layout', label: 'Layout', type: 'select', options: [['lower', 'Unteres Drittel'], ['center', 'Mitte'], ['full', 'Vollbild mit Hintergrund']], default: 'lower' },
      { key: 'showTitle', label: 'Titel anzeigen', type: 'toggle', default: false },
      { key: 'fontSize', label: 'Schriftgröße (px)', type: 'number', default: 54, min: 12, max: 200 },
      { key: 'uppercase', label: 'Großbuchstaben', type: 'toggle', default: false }
    ],
    fullscreen: true
  });

  def('nnt', {
    label: 'Jetzt / Gleich / Danach', icon: '⏭', category: 'Zeit', pro: true,
    controls: ['step'],
    fields: [
      { key: 'labelNow', label: 'Label Jetzt', type: 'text', default: 'Jetzt' },
      { key: 'labelNext', label: 'Label Gleich', type: 'text', default: 'Gleich' },
      { key: 'labelThen', label: 'Label Danach', type: 'text', default: 'Danach' },
      { key: 'items', label: 'Programmpunkte', type: 'list', itemLabel: 'Punkt', fields: [{ key: 'time', label: 'Zeit', type: 'text', default: '' }, { key: 'title', label: 'Titel', type: 'text', default: '' }, { key: 'subtitle', label: 'Untertitel', type: 'text', default: '' }], default: [{ time: '10:00', title: 'Begrüßung', subtitle: '' }, { time: '10:15', title: 'Keynote', subtitle: 'Dr. Beispiel' }, { time: '11:00', title: 'Pause', subtitle: '' }] },
      { key: 'index', label: 'Aktueller Punkt', type: 'number', default: 0, min: 0, hidden: true },
      { key: 'count', label: 'Anzahl anzeigen', type: 'select', options: [['3', '3'], ['2', '2'], ['1', '1']], default: '3' },
      { key: 'layout', label: 'Layout', type: 'select', options: [['row', 'Nebeneinander'], ['column', 'Untereinander']], default: 'row' },
      ...commonPositioned('bottom-center')
    ]
  });

  def('qr', {
    label: 'QR-Code', icon: '▣', category: 'Utility', pro: true,
    fields: [
      { key: 'url', label: 'Link / Text', type: 'text', default: 'https://example.com' },
      { key: 'caption', label: 'Beschriftung', type: 'text', default: 'Jetzt scannen' },
      { key: 'size', label: 'Größe (px)', type: 'number', default: 280, min: 64, max: 1000 },
      { key: 'fg', label: 'Vordergrund', type: 'color', default: '#000000' },
      { key: 'bg', label: 'Hintergrund', type: 'color', default: '#ffffff' },
      ...commonPositioned('bottom-right')
    ]
  });

  def('celebration', {
    label: 'Feier / Konfetti', icon: '🎉', category: 'Effekte', pro: true, fullscreen: true,
    fields: [
      { key: 'effect', label: 'Effekt', type: 'select', options: [['confetti', 'Konfetti'], ['fireworks', 'Feuerwerk'], ['emoji', 'Emoji-Regen'], ['cannons', 'Konfetti-Kanonen']], default: 'confetti' },
      { key: 'emoji', label: 'Emojis', type: 'text', default: '🎉🥳⭐', showIf: { effect: 'emoji' } },
      { key: 'duration', label: 'Dauer (s)', type: 'number', default: 6, min: 1, max: 60 },
      { key: 'intensity', label: 'Intensität', type: 'number', default: 100, min: 10, max: 400 },
      { key: 'message', label: 'Text (optional)', type: 'text', default: '' }
    ]
  });

  def('animbg', {
    label: 'Animierter Hintergrund', icon: '🌈', category: 'Effekte', pro: true, fullscreen: true,
    fields: [
      { key: 'style', label: 'Stil', type: 'select', options: [['blobs', 'Farbblasen'], ['gradient', 'Verlauf'], ['waves', 'Wellen'], ['particles', 'Partikel'], ['grid', 'Raster-Perspektive']], default: 'blobs' },
      { key: 'color1', label: 'Farbe 1 (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      { key: 'color2', label: 'Farbe 2 (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      { key: 'color3', label: 'Farbe 3 (leer = Theme)', type: 'color', default: '', allowEmpty: true },
      { key: 'base', label: 'Grundfarbe', type: 'color', default: '#0b1020' },
      { key: 'speed', label: 'Geschwindigkeit %', type: 'number', default: 100, min: 10, max: 400 },
      { key: 'opacity', label: 'Deckkraft %', type: 'number', default: 100, min: 0, max: 100 }
    ]
  });

  def('qa', {
    label: 'Publikumsfrage (einzeln, manuell)', icon: '❓', category: 'Interaktion', pro: true,
    fields: [
      { key: 'author', label: 'Name', type: 'text', default: 'Anonym' },
      { key: 'question', label: 'Frage', type: 'textarea', default: 'Wie funktioniert das mit dem Fill und Key?' },
      { key: 'heading', label: 'Überschrift', type: 'text', default: 'Frage aus dem Publikum' },
      ...commonPositioned('bottom-center')
    ]
  });

  def('qawall', {
    label: 'Q&A live (Fragen-Wand)', icon: '🙋', category: 'Interaktion', pro: true,
    controls: ['qa'],
    fields: [
      { key: 'mode', label: 'Darstellung', type: 'select', options: [['wall', 'Liste: mehrere Fragen + neueste'], ['single', 'Einzeln: eine Frage']], default: 'wall' },
      { key: 'heading', label: 'Überschrift', type: 'text', default: 'Fragen aus dem Publikum' },
      { key: 'count', label: 'Anzahl Fragen in der Liste', type: 'number', default: 5, min: 1, max: 15, showIf: { mode: 'wall' } },
      { key: 'sort', label: 'Sortierung', type: 'select', options: [['likes', 'Beliebteste zuerst'], ['newest', 'Neueste zuerst'], ['oldest', 'Älteste zuerst']], default: 'likes' },
      { key: 'activeFirst', label: 'Aktive Frage oben anheften', type: 'toggle', default: true, showIf: { mode: 'wall' } },
      { key: 'showNewest', label: 'Neueste Frage separat hervorheben', type: 'toggle', default: true, showIf: { mode: 'wall' } },
      { key: 'singleSource', label: 'Welche Frage (Einzeln)', type: 'select', options: [['active', 'Aktive Frage'], ['activeOrTop', 'Aktive Frage, sonst Top-Frage'], ['newest', 'Neueste Frage'], ['rotate', 'Alle nacheinander (Rotation)']], default: 'activeOrTop', showIf: { mode: 'single' } },
      { key: 'rotateSeconds', label: 'Rotation alle (s)', type: 'number', default: 8, min: 2, max: 120, showIf: { mode: 'single', singleSource: 'rotate' } },
      { key: 'showLikes', label: 'Likes anzeigen', type: 'toggle', default: true },
      { key: 'showAuthor', label: 'Namen anzeigen', type: 'toggle', default: true },
      { key: 'showQr', label: 'QR-Code zur Publikumsseite', type: 'toggle', default: false },
      { key: 'emptyText', label: 'Text ohne Fragen (leer = ausblenden)', type: 'text', default: 'Noch keine Fragen – jetzt mitmachen!' },
      { key: 'width', label: 'Breite (px)', type: 'number', default: 1100, min: 400, max: 1900 },
      ...commonPositioned('middle-right')
    ]
  });

  def('poll', {
    label: 'Umfrage-Ergebnis', icon: '📊', category: 'Interaktion', pro: true,
    fields: [
      { key: 'pollId', label: 'Umfrage', type: 'poll', default: '' },
      { key: 'showVotes', label: 'Stimmenanzahl zeigen', type: 'toggle', default: true },
      { key: 'showPercent', label: 'Prozent zeigen', type: 'toggle', default: true },
      { key: 'showQr', label: 'QR zum Abstimmen zeigen', type: 'toggle', default: false },
      { key: 'hideUntilVotes', label: 'Ergebnisse erst ab x Stimmen zeigen', type: 'number', default: 0, min: 0 },
      { key: 'width', label: 'Breite (px)', type: 'number', default: 820, min: 300, max: 1900 },
      ...commonPositioned('middle-right')
    ]
  });

  def('custom', {
    label: 'Eigene Grafik (Builder)', icon: '✏', category: 'Builder', pro: true, fullscreen: true,
    fields: [
      { key: 'layers', label: 'Ebenen', type: 'builder', default: [
        { id: 'l1', type: 'rect', x: 1040, y: 820, w: 760, h: 140, color: '#111827', opacity: 90, radius: 14, anim: 'slide-left', delay: 0 },
        { id: 'l2', type: 'rect', x: 1040, y: 820, w: 14, h: 140, color: 'var(--primary)', opacity: 100, radius: 0, anim: 'fade', delay: 150 },
        { id: 'l3', type: 'text', x: 1080, y: 838, w: 700, h: 60, text: 'Eigene Grafik', color: '#ffffff', fontSize: 46, fontWeight: 800, align: 'left', anim: 'slide-up', delay: 200 },
        { id: 'l4', type: 'text', x: 1080, y: 900, w: 700, h: 44, text: '{{time}}', color: '#cbd5e1', fontSize: 30, fontWeight: 500, align: 'left', anim: 'slide-up', delay: 300 }
      ] }
    ]
  });

  const CATEGORIES = ['Text', 'Medien', 'Sport', 'Zeit', 'Utility', 'Effekte', 'Interaktion', 'Builder'];

  function allFields(type) {
    const t = T[type];
    if (!t) return [];
    return t.fields.concat(commonAll);
  }

  function defaults(type) {
    const out = {};
    for (const f of allFields(type)) out[f.key] = JSON.parse(JSON.stringify(f.default === undefined ? '' : f.default));
    return out;
  }

  /* Timer-Berechnung, identisch in Server, Steuerung und Output */
  function timerElapsed(timer, now) {
    if (!timer) return 0;
    return (timer.elapsedBefore || 0) + (timer.running ? Math.max(0, now - (timer.startedAt || now)) : 0);
  }
  function timerValueMs(timer, now) {
    const el = timerElapsed(timer, now);
    return timer.mode === 'up' ? el : (timer.duration || 0) * 1000 - el;
  }
  function formatDuration(ms, fmt) {
    // Countdown: positive Werte aufrunden (0 erscheint genau beim Ablauf), Überzug abrunden
    const neg = ms < 0;
    const total = neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000 - 1e-6);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const p = (n) => String(n).padStart(2, '0');
    let str;
    if (fmt === 'ss') str = String(total);
    else if (fmt === 'hh:mm:ss' || (fmt === 'auto' && h > 0)) str = `${p(h)}:${p(m)}:${p(s)}`;
    else str = `${p(h * 60 + m)}:${p(s)}`;
    return (neg && total > 0 ? '-' : '') + str;
  }
  function formatCountUp(ms, fmt) {
    return formatDuration(Math.floor(Math.max(0, ms) / 1000) * 1000, fmt);
  }

  const THEME_PRESETS = {
    studio: { name: 'Studio', primary: '#e11d48', secondary: '#111827', accent: '#f59e0b', text: '#ffffff', textOnPrimary: '#ffffff', panel: 'rgba(17,24,39,0.92)', font: 'Inter, "Helvetica Neue", Arial, sans-serif', headingFont: 'Inter, "Helvetica Neue", Arial, sans-serif', radius: 10, shadow: 0.35, animation: 'slide', animDuration: 600, safeMargin: 80, fontScale: 100 },
    neon: { name: 'Neon', primary: '#22d3ee', secondary: '#0f0a1f', accent: '#f0abfc', text: '#f5f3ff', textOnPrimary: '#0f0a1f', panel: 'rgba(15,10,31,0.85)', font: '"Trebuchet MS", Arial, sans-serif', headingFont: '"Trebuchet MS", Arial, sans-serif', radius: 4, shadow: 0.6, animation: 'wipe', animDuration: 500, safeMargin: 80, fontScale: 100 },
    clean: { name: 'Clean Weiß', primary: '#2563eb', secondary: '#ffffff', accent: '#0f172a', text: '#0f172a', textOnPrimary: '#ffffff', panel: 'rgba(255,255,255,0.96)', font: 'Arial, Helvetica, sans-serif', headingFont: 'Georgia, serif', radius: 16, shadow: 0.2, animation: 'fade', animDuration: 450, safeMargin: 90, fontScale: 100 },
    sport: { name: 'Sport', primary: '#16a34a', secondary: '#0a0a0a', accent: '#facc15', text: '#ffffff', textOnPrimary: '#0a0a0a', panel: 'rgba(10,10,10,0.9)', font: '"Arial Narrow", Arial, sans-serif', headingFont: 'Impact, "Arial Black", sans-serif', radius: 0, shadow: 0.4, animation: 'wipe', animDuration: 400, safeMargin: 60, fontScale: 105 },
    worship: { name: 'Gottesdienst', primary: '#b08d57', secondary: '#1c1917', accent: '#fef3c7', text: '#fafaf9', textOnPrimary: '#1c1917', panel: 'rgba(28,25,23,0.8)', font: 'Georgia, "Times New Roman", serif', headingFont: 'Georgia, "Times New Roman", serif', radius: 6, shadow: 0.5, animation: 'fade', animDuration: 900, safeMargin: 100, fontScale: 100 },
    corporate: { name: 'Corporate', primary: '#0ea5e9', secondary: '#0b2545', accent: '#13315c', text: '#ffffff', textOnPrimary: '#ffffff', panel: 'rgba(11,37,69,0.94)', font: '"Segoe UI", Roboto, Arial, sans-serif', headingFont: '"Segoe UI", Roboto, Arial, sans-serif', radius: 2, shadow: 0.3, animation: 'slide', animDuration: 550, safeMargin: 80, fontScale: 100 }
  };

  return { TYPES: T, CATEGORIES, POSITIONS, ANIMATIONS, allFields, defaults, timerElapsed, timerValueMs, formatDuration, formatCountUp, THEME_PRESETS, defaultTimer };
});
