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
      // follow:每轮一次 getSignaturesForAddress，遇到已知签名即停——适合演示时实时跟随(几乎不耗 RPC 额度)。
      // tail:逐 slot getBlock，只适合扫一小段；追赶历史请用 backfill。
      const inserted = options.mode === 'backfill' ? await backfill(db, rpc, marginfiIdl.address)
        : options.mode === 'follow' ? await backfill(db, rpc, marginfiIdl.address, { stopAtKnown: true })
        : await tailOnce(db, rpc, marginfiIdl.address, options.from, options.to);
      const { decoded, snapshots } = await syncStored(db, rpc, marginfiIdl);
      console.log(`inserted=${inserted} decoded=${decoded} snapshots=${snapshots}`);
      if (options.mode === 'backfill' || options.once || options.to !== undefined) return;
      // follow 每 5 秒一轮(finalized 本身就有十几秒延迟，更频繁没有意义)。
      await new Promise(resolve => setTimeout(resolve, options.mode === 'follow' ? 5000 : 2000));
    }
  });
}
void main().catch(reportError);
