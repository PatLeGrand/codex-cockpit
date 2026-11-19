import path from 'node:path';
import os from 'node:os';
import { SessionStore } from './sessions.mjs';
import { startServer } from './server.mjs';
import { serveMcp } from './mcp.mjs';
import { demoStore } from './demo.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Codex Cockpit\nnode src/cli.mjs [--mcp] [--demo] [--port 4318]\n\nCODEX_HOME: optional Codex data directory. Default: ~/.codex\nNo API key or npm install required.');
  process.exit(0);
}
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port');
const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
const cockpit = await startServer(args.includes('--demo') ? demoStore : new SessionStore(root), { port });
if (args.includes('--mcp')) serveMcp(cockpit);
else console.log(`Codex Cockpit${args.includes('--demo') ? ' — DÉMONSTRATION' : ''}\n${cockpit.url}\nCtrl+C pour arrêter.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cockpit.server.closeAllConnections(); cockpit.close().then(() => process.exit(0)); });
