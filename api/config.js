import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
function integer(name, fallback, max = 65535) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
export const config = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: integer('PORT', 3100),
  db: { host: process.env.DB_HOST || '127.0.0.1', port: integer('DB_PORT', 3306), user: process.env.DB_USER || 'admin', password: process.env.DB_PASS, database: process.env.DB_NAME || 'projects', connectionLimit: integer('DB_CONNECTION_LIMIT', 10, 100) },
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || '.local/uploads'),
  maxUpload: integer('MAX_UPLOAD_BYTES', 26214400, 104857600),
  maxAvatar: integer('MAX_AVATAR_BYTES', 2097152, 10485760),
  logLevel: process.env.LOG_LEVEL || 'info',
  timezone: process.env.APP_TIMEZONE || 'Asia/Tokyo'
};
if (config.host !== '127.0.0.1') throw new Error('HOST must be 127.0.0.1; expose this application through Nginx.');
