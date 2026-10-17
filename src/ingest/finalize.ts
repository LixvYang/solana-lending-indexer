/** INPUT: Db 里 finalized=false 的行、RPC 的签名状态。 OUTPUT: 终局确认/丢弃计数。 POSITION: 乐观入库(confirmed)的安全网。 SYNC: folder.md。 */
import type { Db } from '../store/db';

export interface SweepRpc {
  getFinalizedSlot(): Promise<number>;
  getSignatureStatuses(signatures: string[]): Promise<({ slot: number; confirmationStatus?: string; err: unknown } | null)[]>;
}

/**
 * 如果状态是"查不到"，要等这么多 slot(约 60 秒)才敢判定它在被丢弃的分叉上。
 * 为什么不能马上删：负载均衡的 RPC 节点可能落后，暂时查不到一笔真实存在的交易；误删比晚删糟糕得多。
 */
export const DROP_AFTER_SLOTS = 150;

// #region ep6-finalize-sweep
/**
 * 乐观入库的安全网:confirmed 就入库让页面更快,之后逐步确认它们是否真的 finalized。
 *  - 状态是 finalized          → 标记为终局;
 *  - 查不到,且 finalized slot 已超过它 150 个 slot → 它在被丢弃的分叉上,删除(解码出的指令/事件随外键级联删除);
 *  - 其余(还在 confirmed、或还没过观察期)→ 下一轮再看。
 */
export async function finalizeSweep(db: Db, rpc: SweepRpc, batch = 100): Promise<{ finalized: number; dropped: number; pending: number }> {
  const rows = (await db.query('SELECT signature, slot FROM raw_tx WHERE NOT finalized ORDER BY slot LIMIT $1', [batch])).rows;
  if (!rows.length) return { finalized: 0, dropped: 0, pending: 0 };
  const finalizedSlot = await rpc.getFinalizedSlot();
  const statuses = await rpc.getSignatureStatuses(rows.map(r => String(r.signature)));
  let finalized = 0, dropped = 0, pending = 0;
  for (const [i, row] of rows.entries()) {
    const status = statuses[i], signature = String(row.signature);
    if (status?.confirmationStatus === 'finalized') {
      await db.query('UPDATE raw_tx SET finalized = TRUE WHERE signature = $1', [signature]); finalized++;
    } else if (!status && finalizedSlot >= Number(row.slot) + DROP_AFTER_SLOTS) {
      await db.query('DELETE FROM raw_tx WHERE signature = $1', [signature]); dropped++;
    } else pending++;
  }
  return { finalized, dropped, pending };
}
// #endregion
