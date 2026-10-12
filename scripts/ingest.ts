/** INPUT: RPC_URL、DATABASE_URL、CLI 模式。 OUTPUT: finalized 入库/解码/当前账户快照。 POSITION: EP6 只读链上采集入口。 SYNC: 同步 folder.md。 */
import { parseIngestArgs, ingestUsage } from './ingest-options';
import { runStoreCommand, reportError } from './store-command';
import { Rpc } from '../src/ingest/rpc';
import { backfill } from '../src/ingest/signatures';
import { tailOnce } from '../src/ingest/tail';
import { syncStored } from '../src/store/sync';
import { marginfiIdl } from '../src/decoder/idl';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: ' + ingestUsage.replace(/^用法: /, '')); return; }
  const options = parseIngestArgs(args);
  if (!process.env.RPC_URL) throw new Error('RPC_URL is required');
  const rpc = new Rpc(process.env.RPC_URL);
  await runStoreCommand(async db => {
    for (;;) {
      const inserted = options.mode === 'backfill' ? await backfill(db, rpc, marginfiIdl.address)
        : await tailOnce(db, rpc, marginfiIdl.address, options.from, options.to);
      const { decoded, snapshots } = await syncStored(db, rpc, marginfiIdl);
      console.log(`inserted=${inserted} decoded=${decoded} snapshots=${snapshots}`);
      if (options.mode === 'backfill' || options.once || options.to !== undefined) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  });
}
void main().catch(reportError);
