import { writeFile } from 'node:fs/promises';
import { buildApp } from './app.js';
const app = await buildApp({ logger: false });
await app.ready();
await writeFile(new URL('./openapi.json', import.meta.url), JSON.stringify(app.swagger(), null, 2)+'\n');
await app.close();
console.log('Wrote api/openapi.json');
