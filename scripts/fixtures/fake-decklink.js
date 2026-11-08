// Nachbildung des nativen DeckLink-Moduls für Tests
const state = global.__fakeDL || (global.__fakeDL = { busyByOther: false, holder: null, log: [], next: 1 });
module.exports = {
  version: () => ({ sdk: '16.0', driver: '16.0 (Test)' }),
  listDevices: () => ({ devices: [{ key: 'dev0', index: 0, name: 'UltraStudio Monitor 3G (Test)', model: 'UltraStudio Monitor 3G', canOutput: true, canInput: false, externalKeying: false, internalKeying: false, outputModes: [{ id: 'Hp50', name: '1080p50', width: 1920, height: 1080, fps: 50 }] }] }),
  createOutput: (o) => { if (state.busyByOther || state.holder) throw new Error('Ausgabe konnte nicht aktiviert werden – Gerät belegt'); const h = { id: state.next++ }; state.holder = h.id; state.log.push('claim'); return h; },
  start: () => ({ width: 1920, height: 1080 }),
  status: (h) => ({ running: state.holder === h.id, width: 1920, height: 1080, fps: 50, completed: 0, pushed: 0 }),
  push: () => {},
  stop: (h) => { if (state.holder === h.id) { state.holder = null; state.log.push('release'); } }
};
