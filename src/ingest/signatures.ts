/** INPUT: finalized 签名分页、Db。 OUTPUT: backfill 新写入计数。 POSITION: EP6 历史取交易。 SYNC: 同步 folder.md。 */
import type { Db } from '../store/db';
import { insertRawTx } from '../store/raw';
import type { SignatureInfo, RawTransaction } from './rpc';
export interface SignatureRpc {
  getSignaturesForAddress(address: string, before?: string): Promise<SignatureInfo[]>;
  getTransaction(signature: string): Promise<RawTransaction | null>;
}
export async function backfill(db: Db, rpc: SignatureRpc, programId: string): Promise<number> {
  let before: string | undefined, count = 0;
  for (;;) {
    const page = await rpc.getSignaturesForAddress(programId, before);
    if (!page.length) return count;
    for (const info of page) {
      if ((await db.query('SELECT signature FROM raw_tx WHERE signature = $1', [info.signature])).rowCount) continue;
      const tx = await rpc.getTransaction(info.signature);
      if (!tx) throw new Error(`transaction unavailable: ${info.signature}`);
      if (tx.transaction.signatures[0] !== info.signature) throw new Error(`transaction signature mismatch: ${info.signature}`);
      // err 非空也入库；只有事件解码会跳过失败交易。
      if (await insertRawTx(db, tx)) count++;
    }
    const next = page.at(-1)!.signature;
    if (next === before) throw new Error('signature pagination did not advance');
    before = next;
  }
}
