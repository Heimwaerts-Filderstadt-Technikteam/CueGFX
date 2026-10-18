'use strict';
/* Unsichtbares Offscreen-Fenster, das einen Grafik-Ausgang rendert und jedes Bild als BGRA-Puffer liefert */

function createOffscreenRenderer({ BrowserWindow, url, width, height, fps, audio, onFrame, log, tag }) {
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    enableLargerThanScreen: true, paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
  });
  win.setContentSize(width, height);
  win.webContents.setAudioMuted(!audio);
  win.webContents.setFrameRate(Math.min(240, Math.max(1, Math.ceil(fps || 30))));
  const st = { frames: 0, renderFps: 0, lastTick: Date.now(), captureMode: false, silent: 0, stopped: false };
  const deliver = (image) => {
    if (st.stopped) return;
    const s = image.getSize();
    if (!s.width || !s.height) return;
    try { onFrame(image.toBitmap(), s.width, s.height); } catch (_) {}
    st.frames++;
  };
  win.webContents.on('paint', (_e, _dirty, image) => { if (!st.captureMode) deliver(image); });
  win.webContents.on('render-process-gone', () => { log && log(`[${tag}] Renderer abgestürzt, lade neu`); setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url); }, 500); });
  win.webContents.on('did-fail-load', () => setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url); }, 1000));
  win.loadURL(url);
  st.timer = setInterval(() => {
    const now = Date.now();
    st.renderFps = Math.round((st.frames * 1000) / Math.max(1, now - st.lastTick));
    st.frames = 0; st.lastTick = now;
    if (win.isDestroyed()) return;
    // Ohne Änderungen malt Chromium nichts – regelmäßig ein Bild anfordern
    win.webContents.invalidate();
    st.silent = st.renderFps === 0 ? st.silent + 1 : 0;
    if (st.silent >= 3 && !st.captureTimer) {
      log && log(`[${tag}] Offscreen-Rendering liefert keine Bilder – nutze Bildabgriff`);
      st.captureMode = true;
      let busy = false;
      st.captureTimer = setInterval(() => {
        if (busy || win.isDestroyed()) return;
        busy = true;
        win.webContents.capturePage().then(deliver).catch(() => {}).finally(() => { busy = false; });
      }, Math.round(1000 / Math.min(30, Math.max(10, fps || 25))));
    }
  }, 1000);
  return {
    win,
    stats: () => ({ renderFps: st.renderFps, captureMode: st.captureMode }),
    stop: () => {
      st.stopped = true;
      clearInterval(st.timer);
      clearInterval(st.captureTimer);
      if (!win.isDestroyed()) win.destroy();
    }
  };
}

module.exports = { createOffscreenRenderer };
