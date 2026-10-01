import { migrateProjectKeys } from './migrations/project-keys.js';
import mysql from 'mysql2/promise';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { config, root } from './config.js';
if (process.env.CONFIRM_DEMO_SEED !== 'yes') throw new Error('Opt in explicitly: CONFIRM_DEMO_SEED=yes npm run db:seed');
const c = await mysql.createConnection({ ...config.db, multipleStatements: true });
try {
  const sql = (await readFile(path.join(root, 'db/seed.sql'), 'utf8')).replace(/^USE projects;$/m, '');
  await c.query(sql);
  await migrateProjectKeys(c, config.db.database, {refresh:true});
  await mkdir(path.join(config.uploadDir, 'demo'), { recursive: true });
  await copyFile(path.join(root,'db/demo-files/release-checklist.txt'),path.join(config.uploadDir,'demo/release-checklist.txt'));
  console.log('Optional demo data loaded. Existing IDs were preserved.');
} finally { await c.end(); }
