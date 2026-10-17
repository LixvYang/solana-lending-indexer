/** INPUT: Db 与完整 RPC 交易。 OUTPUT: insertRawTx 是否新插入。 POSITION: EP6 原始事实入口。 SYNC: 同步 folder.md。 */
import type { Db } from './db';
import { toJson } from './json';
import type { RawTransaction } from '../ingest/rpc';
// #region ep6-idempotent-insert
/** finalized=false 表示乐观入库(confirmed):之后要由终局清扫确认或删除。默认 true,与此前的行为一致。 */
export async function insertRawTx(db: Db, tx: RawTransaction, finalized = true): Promise<boolean> {
  const signature = tx.transaction.signatures[0];
  if (!signature || !Number.isSafeInteger(tx.slot) || tx.slot < 0) throw new Error('invalid transaction signature/slot');
  const result = await db.query(`INSERT INTO raw_tx(signature, slot, block_time, err, tx, finalized)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
    ON CONFLICT (signature) DO NOTHING RETURNING signature`,
  [signature, tx.slot, tx.blockTime == null ? null : new Date(tx.blockTime * 1000),
    // 成功交易的 err 必须是 SQL NULL；toJson(null) 会得到 JSONB 的 null(不是 SQL NULL)，
    // 那样 `WHERE err IS NULL` 一笔成功交易都查不到。真实 Postgres 上才发现的 bug。
    tx.meta?.err == null ? null : toJson(tx.meta.err), toJson(tx), finalized]);
  return result.rows.length === 1;
}
// #endregion
