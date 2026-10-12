/** INPUT: Db、剧本 addresses（无私钥）。 OUTPUT: loadLabels 幂等链下标签。 POSITION: EP7 元数据导入。 SYNC: 同步 folder.md。 */
import type { Db } from './db';
interface Addresses {
  mints: Record<string, string>;
  banks: Record<string, string>;
  marginfiAccounts: Record<string, string>;
  actors: Record<string, string>;
}
export async function loadLabels(db: Db, addresses: Addresses): Promise<number> {
  let count = 0;
  await db.transaction(async (tx) => {
    for (const kind of ['mints', 'banks', 'marginfiAccounts', 'actors'] as const) {
      // bank 与 mint 用同一个代币符号做标签，界面里才一致。
      for (const [name, address] of Object.entries(addresses[kind])) {
        await tx.query(`INSERT INTO labels(address,label,kind) VALUES ($1,$2,$3)
     ON CONFLICT(address) DO UPDATE SET label=EXCLUDED.label, kind=EXCLUDED.kind`, [address, name, kind]);
        count++;
      }
    }
  });
  return count;
}
