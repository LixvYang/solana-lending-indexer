/** INPUT: Db、本地 SQL 目录。 OUTPUT: migrate。 POSITION: EP6 手写迁移入口。 SYNC: 同步 folder.md。 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';
export async function migrate(db: Db, directory = join(process.cwd(), 'src/store/migrations')): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(join(directory, name), 'utf8');
    await db.transaction(async tx => {
      if ((await tx.query('SELECT name FROM schema_migrations WHERE name = $1', [name])).rowCount) return;
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
  }
}
