/** INPUT: finalized 区块 RPC、Db 游标。 OUTPUT: tailOnce 一轮写入计数。 POSITION: EP6 每 slot 原子提交。 SYNC: 同步 folder.md。 */
import type { Db } from '../store/db';
import { insertRawTx } from '../store/raw';
import { fetchProgramTxs, type BlockRpc } from './block';
export interface TailRpc extends BlockRpc { getSlot(): Promise<number> }
export async function tailOnce(db: Db, rpc: TailRpc, programId: string, from?: number, to?: number): Promise<number> {
  // to 只是上界(不能越过当前 finalized)：用于只扫一小段 slot。
  const finalized = await rpc.getSlot();
  const latest = to === undefined ? finalized : Math.min(to, finalized);
  if (!Number.isSafeInteger(latest) || latest < 0) throw new Error('invalid finalized slot');
  if (from !== undefined && (!Number.isSafeInteger(from) || from < 0)) throw new Error('invalid --from slot');
  const cursor = (await db.query("SELECT slot FROM ingest_cursor WHERE name = 'blocks'")).rows[0];
  // 首次默认从当前 finalized slot 开始；--from 含起点。已有游标总是优先，避免意外回退。
  const initial = cursor ? Number(cursor.slot) : (from ?? latest) - 1;
  let inserted = 0;
  for (let slot = initial + 1; slot <= latest; slot++) {
    const transactions = await fetchProgramTxs(rpc, slot, programId);
    // #region ep6-cursor-tx
    inserted += await db.transaction(async tx => {
      await tx.query("INSERT INTO ingest_cursor(name, slot) VALUES ('blocks', $1) ON CONFLICT (name) DO NOTHING", [initial]);
      const current = (await tx.query("SELECT slot FROM ingest_cursor WHERE name = 'blocks' FOR UPDATE")).rows[0];
      if (Number(current.slot) >= slot) return 0;
      let count = 0;
      for (const transaction of transactions) if (await insertRawTx(tx, transaction)) count++;
      // 空块/跳过 slot 也推进；异常会同时回滚本 slot 的 raw_tx 与游标。
      await tx.query("UPDATE ingest_cursor SET slot = $1 WHERE name = 'blocks'", [slot]);
      return count;
    });
    // #endregion
  }
  return inserted;
}
