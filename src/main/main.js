'use strict';
/* CueGFX – Desktop-App (macOS, Windows, Linux) */
const { app, BrowserWindow, Menu, shell, screen, dialog, nativeTheme } = require('electron');
const path = require('path');
const { CueServer } = require('../server/index');
const { DeckLinkManager } = require('../decklink/manager');
const { DisplayManager } = require('./displays');
const { NdiManager } = require('./ndi');

// Grafiken müssen auch im Hintergrund flüssig laufen und Medien ohne Klick starten
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let server = null, controlWin = null, decklink = null, displays = null, ndi = null;
const extraWindows = new Set();
const log = (...a) => console.log('[CueGFX]', ...a);
const port = () => (server ? server.port : 4001);
const baseUrl = () => `http://127.0.0.1:${port()}`;

async function startServer() {
  const dataDir = process.env.CUEGFX_DATA || path.join(app.getPath('userData'), 'data');
  server = new CueServer({
    dataDir,
    hooks: {
      desktop: true,
      openWindow: (p) => openOutputWindow(p),
      get decklink() { return decklink; },
      get displays() { return displays; },
      get ndi() { return ndi; },
      mainWindow: () => controlWin
    }
  });
  for (let i = 0; i < 20; i++) {
    try { await server.start(); break; } catch (e) {
      if (e.code !== 'EADDRINUSE' || i === 19) throw e;
      log(`Port ${server.port} belegt, versuche ${server.port + 1}`);
      server.port += 1;
    }
  }
  log(`Server läuft auf ${baseUrl()}`);
}

function createControlWindow() {
  nativeTheme.themeSource = 'dark';
  controlWin = new BrowserWindow({
    width: 1560, height: 940, minWidth: 900, minHeight: 600, backgroundColor: '#0d0f12', title: 'CueGFX',
    show: false, autoHideMenuBar: process.platform !== 'darwin',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  controlWin.loadURL(`${baseUrl()}/control`);
  controlWin.once('ready-to-show', () => controlWin.show());
  controlWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl()) && /\/output\//.test(url)) { openOutputWindow(new URL(url).pathname + new URL(url).search); return { action: 'deny' }; }
    if (url.startsWith(baseUrl())) return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 800, backgroundColor: '#0d0f12', autoHideMenuBar: true } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  controlWin.on('closed', () => { controlWin = null; });
}

function openOutputWindow(p) {
  const w = new BrowserWindow({
    width: 960, height: 540, useContentSize: true, backgroundColor: '#000000', title: `CueGFX ${p}`, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  w.setAspectRatio(16 / 9);
  w.loadURL(baseUrl() + (p.startsWith('/') ? p : '/' + p));
  extraWindows.add(w);
  w.on('closed', () => extraWindows.delete(w));
  return w;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const outputsMenu = () => {
    const outs = server && server.project ? server.project.settings.outputs : [{ id: '1', name: 'Hauptausgang' }];
    return [
      { label: 'Vorschau-Ausgang', click: () => openOutputWindow('/output/preview') },
      { type: 'separator' },
      ...outs.map((o) => ({ label: `Ausgang ${o.id} – ${o.name}`, click: () => openOutputWindow(`/output/${o.id}`) }))
    ];
  };
  const template = [
    ...(isMac ? [{ role: 'appMenu', label: 'CueGFX' }] : []),
    {
      label: 'Datei',
      submenu: [
        { label: 'Steuerung im Browser öffnen', click: () => shell.openExternal(`${baseUrl()}/control`) },
        { label: 'Publikums-Seite öffnen', click: () => shell.openExternal(`${baseUrl()}/audience`) },
        { label: 'Datenordner anzeigen', click: () => shell.openPath(path.join(app.getPath('userData'), 'data')) },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fenster schließen' } : { role: 'quit', label: 'Beenden' }
      ]
    },
    { label: 'Bearbeiten', submenu: [{ role: 'undo', label: 'Rückgängig' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' }, { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }] },
    { label: 'Ausgänge', submenu: outputsMenu() },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' }, { role: 'forceReload', label: 'Neu laden (erzwingen)' }, { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
        { type: 'separator' }, { role: 'resetZoom', label: 'Originalgröße' }, { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' }, { role: 'togglefullscreen', label: 'Vollbild' }
      ]
    },
    {
      label: 'Hilfe',
      submenu: [
        { label: `Server: ${baseUrl()}`, enabled: false },
        { label: 'API-Infos', click: () => shell.openExternal(`${baseUrl()}/api/info`) },
        { label: 'Über CueGFX', click: () => dialog.showMessageBox({ type: 'info', title: 'CueGFX', message: `CueGFX ${app.getVersion()}`, detail: `Live-Grafiken mit DeckLink-/UltraStudio-Ausgabe.\nServer: ${baseUrl()}\nNetzwerk: ${server ? server.lanUrls().join(', ') : ''}` }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox('CueGFX konnte nicht starten', e.message);
    app.quit();
    return;
  }
  displays = new DisplayManager({ BrowserWindow, screen, getPort: port, log });
  decklink = new DeckLinkManager({ BrowserWindow, getPort: port, getProject: () => server.project, log });
  // Gespeicherte Hardware-Konfiguration wiederherstellen
  try { displays.configure(server.store.config.displayOutputs || []); } catch (e) { log('Bildschirme:', e.message); }
  if (decklink.available) {
    try { await decklink.configure(server.store.config.decklinkOutputs || []); } catch (e) { log('DeckLink:', e.message); }
  } else log('DeckLink:', decklink.loadError);
  ndi = new NdiManager({ BrowserWindow, getPort: port, log, dialog, libPath: server.store.config.ndiLibPath || '' });
  if (ndi.available) {
    try { ndi.configure(server.store.config.ndiOutputs || []); } catch (e) { log('NDI:', e.message); }
  } else log('NDI:', ndi.loadError);
  buildMenu();
  server.on('state', () => {
    // Menü aktualisieren, wenn sich Ausgänge ändern
    const sig = server.project.settings.outputs.map((o) => o.id + o.name).join('|');
    if (sig !== buildMenu.sig) { buildMenu.sig = sig; buildMenu(); }
  });
  createControlWindow();
  app.on('activate', () => { if (!controlWin) createControlWindow(); });
});

app.on('second-instance', () => { if (controlWin) { if (controlWin.isMinimized()) controlWin.restore(); controlWin.focus(); } });

app.on('window-all-closed', () => {
  // Offscreen-DeckLink-Fenster zählen nicht – App beendet sich mit dem Steuerfenster
  app.quit();
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  try { if (decklink) decklink.stopAll(); } catch (_) {}
  try { if (ndi) ndi.stopAll(); } catch (_) {}
  try { if (displays) displays.closeAll(); } catch (_) {}
  try { if (server) await server.stop(); } catch (_) {}
  app.exit(0);
});

// Steuerfenster schließen = App beenden (auch auf macOS, da Ausgänge sonst unsichtbar weiterlaufen würden)
app.on('browser-window-created', (_e, win) => {
  win.on('close', () => { if (win === controlWin) setImmediate(() => app.quit()); });
});
