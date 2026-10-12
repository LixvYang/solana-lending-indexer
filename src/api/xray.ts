/** INPUT: Db 原始交易与解码行。 OUTPUT: getXray 保留 RPC base58/base64 原文与数据库行。 POSITION: EP7 三种形态联结。 SYNC: 同步 folder.md。 */
import type { Db } from '../store/db';
import { decodeBase58 } from '../core/base58';
import type { RpcTransaction } from '../decoder/transaction';
import { accountNames, type RpcInstruction } from '../decoder/instruction';
import { marginfiIdl } from '../decoder/idl';
import type { XrayView, XrayInstruction } from './types';
import { byteSpans, rawSpans } from './spans';
import { iso } from './state';
// PostgreSQL 的 JSONB 不保留键顺序(按键长度再按字节序重排)，而账户在指令里的位置是有语义的，
// 参数的顺序也决定字节布局。所以从库里读出来之后，按 IDL 声明的顺序重新排好再给前端。
function inIdlOrder<T>(order: string[], values: Record<string, T> | undefined): Record<string, T> {
  const source = values ?? {};
  const known = order.filter(name => name in source).map(name => [name, source[name]] as const);
  const rest = Object.entries(source).filter(([name]) => !order.includes(name));
  return Object.fromEntries([...known, ...rest]);
}

// #region ep7-xray
export async function getXray(db: Db, signature: string): Promise<XrayView | null> {
  const row = (await db.query('SELECT * FROM raw_tx WHERE signature=$1', [signature])).rows[0];
  if (!row)
    return null;
  const raw = row.tx as RpcTransaction, logs = raw.meta?.logMessages ?? [];
  const instructions = (await db.query('SELECT * FROM instructions WHERE signature=$1 ORDER BY ix_index,inner_index', [signature])).rows;
  const events = (await db.query('SELECT * FROM events WHERE signature=$1 ORDER BY log_index', [signature])).rows;
  const keys = [...raw.transaction.message.accountKeys, ...(raw.meta?.loadedAddresses?.writable ?? []), ...(raw.meta?.loadedAddresses?.readonly ?? [])];
  const positions: {
    ix: RpcInstruction;
    ix_index: number;
    inner_index: number | null;
  }[] = [];
  raw.transaction.message.instructions.forEach((ix, ix_index) => {
    positions.push({ ix, ix_index, inner_index: null });
    for (const group of raw.meta?.innerInstructions ?? [])
      if (group.index === ix_index)
        group.instructions.forEach((inner, inner_index) => positions.push({ ix: inner, ix_index, inner_index }));
  });
  const decoded = positions.map(({ ix, ix_index, inner_index }): XrayInstruction => {
    const stored = instructions.find(r => r.ix_index === ix_index && r.inner_index === (inner_index ?? -1));
    const program = keys[ix.programIdIndex] ?? 'unknown', name = stored ? String(stored.name) : 'unknown';
    const entry = marginfiIdl.instructions.find(i => i.name === name);
    let data_hex = '', spans: XrayInstruction['spans'] = [], decode_error = stored?.decode_error as string | null ?? null;
    try {
      const bytes = decodeBase58(ix.data);
      data_hex = bytes.toString('hex');
      if (program === marginfiIdl.address && stored && !decode_error) {
        try {
          spans = byteSpans(bytes);
        }
        catch (error) {
          decode_error = (error as Error).message;
          spans = rawSpans(bytes);
        }
      }
      else
        spans = rawSpans(bytes);
    }
    catch {
      decode_error = 'invalid base58 instruction data';
    }
    return { ix_index, inner_index, program, name, data_base58: ix.data, data_hex, spans,
      args: inIdlOrder(entry?.args.map(a => a.name) ?? [], stored?.args as Record<string, unknown>),
      accounts: inIdlOrder(entry ? accountNames(entry.accounts) : [], stored?.accounts as Record<string, string>),
      remaining: stored?.remaining as string[] ?? [], decode_error };
  });
  return { signature, slot: String(row.slot), block_time: iso(row.block_time), err: row.err ?? null, logs, instructions: decoded,
    events: events.map(e => ({ log_index: Number(e.log_index), ix_index: Number(e.ix_index), name: String(e.name),
      base64: (logs[Number(e.log_index)] ?? '').slice('Program data: '.length), data: e.data as Record<string, unknown> })),
    rows: { instructions, events } };
}
// #endregion
