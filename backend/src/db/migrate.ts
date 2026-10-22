import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './pool';

async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const migrationDir = path.resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const name of files) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(migrationDir, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

migrate().catch((error) => { console.error(error); process.exitCode = 1; });
