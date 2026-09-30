import mysql from 'mysql2/promise';
import { config } from './config.js';
export function createPool(overrides = {}) {
  return mysql.createPool({ ...config.db, ...overrides, waitForConnections: true, queueLimit: 100, charset: 'utf8mb4_unicode_ci', timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
}
export async function transaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
