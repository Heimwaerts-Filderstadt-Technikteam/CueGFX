'use strict';
/* Server ohne Desktop-Oberfläche starten (für Entwicklung und Tests). Die normale Nutzung erfolgt über die Desktop-App. */
const path = require('path');
const { CueServer } = require('./index');

const dataDir = process.env.CUEGFX_DATA || path.join(require('os').homedir(), '.cuegfx');
const port = Number(process.env.PORT) || undefined;
const server = new CueServer({ dataDir, port });
server.start().then((p) => {
  console.log(`CueGFX läuft auf http://localhost:${p}/control`);
  for (const u of server.lanUrls()) console.log('  im Netzwerk: ' + u + '/control');
});
const quit = () => server.stop().then(() => process.exit(0));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
