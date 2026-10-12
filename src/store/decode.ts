/**
 * INPUT: Db 的 raw_tx/账户原始快照、固定 IDL。
 * OUTPUT: decodePending、rebuildDecoded；派生行与版本在事务内更新。
 * POSITION: EP6 重放管线。SYNC: 同步 folder.md。
 */
import type { Idl } from '../decoder/idl';
import { decodeTransaction } from '../decoder/transaction';
import { decodeEvents } from '../decoder/event';
import { DECODER_VERSION } from '../decoder/version';
import type { RawTransaction } from '../ingest/rpc';
import type { Db } from './db';
import { toJson } from './json';
import { accountData } from './accounts';
async function pending(tx: Db, idl: Idl): Promise<number> {
  const { rows } = await tx.query(`SELECT signature, slot, block_time, tx FROM raw_tx
    WHERE decoded_version IS NULL OR decoded_version < $1 ORDER BY slot, signature FOR UPDATE`, [DECODER_VERSION]);
  for (const row of rows) {
    const raw = row.tx as RawTransaction;
    // 新版本可能减少输出：先删除旧版本行，不能只 upsert 新结果。
    await tx.query('DELETE FROM instructions WHERE signature = $1', [row.signature]);
    await tx.query('DELETE FROM events WHERE signature = $1', [row.signature]);
    for (const ix of decodeTransaction(raw, idl)) {
      const args = 'args' in ix ? ix.args : ix;
      await tx.query(`INSERT INTO instructions(signature, ix_index, inner_index, slot, block_time,
        stack_height, name, args, accounts, remaining, decode_error)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)`,
      [row.signature, ix.ixIndex, ix.innerIndex ?? -1, row.slot, row.block_time, ix.stackHeight,
        ix.name, toJson(args), toJson('accounts' in ix ? ix.accounts : {}),
        toJson('remaining' in ix ? ix.remaining : []), 'decodeError' in ix ? ix.decodeError : null]);
    }
    const batch = decodeEvents(raw, idl);
    for (const event of batch.events) await tx.query(`INSERT INTO events(signature, log_index, ix_index,
      slot, block_time, name, data, truncated) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [row.signature, event.logIndex, event.ixIndex, row.slot, row.block_time, event.name,
      toJson(typeof event.data === 'string' ? event : event.data), batch.truncated]);
    await tx.query('UPDATE raw_tx SET decoded_version = $1 WHERE signature = $2', [DECODER_VERSION, row.signature]);
  }
  return rows.length;
}
export function decodePending(db: Db, idl: Idl): Promise<number> {
  return db.transaction(tx => pending(tx, idl));
}
// #region ep6-rebuild
export function rebuildDecoded(db: Db, idl: Idl): Promise<number> {
  return db.transaction(async tx => {
    await tx.query('DELETE FROM instructions');
    await tx.query('DELETE FROM events');
    await tx.query('UPDATE raw_tx SET decoded_version = NULL');
    // account_states 同时保留原始快照，不能删掉唯一的历史字节。
    const states = (await tx.query('SELECT address, slot, data FROM account_states')).rows;
    for (const state of states) {
      const { type, data } = accountData((state.data as { raw_data: string }).raw_data, idl);
      await tx.query('UPDATE account_states SET type = $1, data = $2::jsonb WHERE address = $3 AND slot = $4',
        [type, toJson(data), state.address, state.slot]);
    }
    return pending(tx, idl);
  });
}
// #endregion
