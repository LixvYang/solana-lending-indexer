/** INPUT: 本地 m1-run addresses / DATABASE_URL。 OUTPUT: 链下 labels 导入。 POSITION: EP7 CLI（写库，无 RPC）。 SYNC: 同步 folder.md。 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runStoreCommand } from './store-command';
import { loadLabels } from '../src/store/labels';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('用法: load-labels [m1-run.json]');
    return;
  }
  if (args.length > 1 || args.some(a => a.startsWith('--')))
    throw new Error('invalid arguments');
  const run = JSON.parse(readFileSync(resolve(args[0] ?? 'fixtures/m1-run.json'), 'utf8'));
  // 剧本之外后加的代币(如 pSOL)记在入库的部署记录里;只在使用默认剧本时一起导入。
  const extra = args[0] ? null : JSON.parse(readFileSync(resolve('program/devnet.json'), 'utf8')).labels as { mints: Record<string, string>; banks: Record<string, string> } | undefined;
  const addresses = extra ? { ...run.addresses, mints: { ...run.addresses.mints, ...extra.mints }, banks: { ...run.addresses.banks, ...extra.banks } } : run.addresses;
  await runStoreCommand(async (db) => { console.log(`labels loaded: ${await loadLabels(db, addresses)}`); });
}
void main().catch(() => { console.error('label import failed; check arguments, fixture and database'); process.exitCode = 1; });
