import { buildApp } from './app.js';
import { config } from './config.js';
const app = await buildApp();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
try { await app.listen({ host: config.host, port: config.port }); }
catch (err) { app.log.error(err); await app.close(); process.exitCode = 1; }
