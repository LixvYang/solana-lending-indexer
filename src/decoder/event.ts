/**
 * INPUT: RPC 交易日志与固定 IDL。
 * OUTPUT: events（含顶层 ixIndex/logIndex）、交易级 truncated 标记。
 * POSITION: EP5 Anchor 日志纯解码；不依赖 Anchor。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { Reader } from '../core/reader';
import { decodeType } from './borsh';
import type { Idl } from './idl';
import type { RpcTransaction } from './transaction';
export type DecodedEvent = { signature: string; name: string; ixIndex: number; logIndex: number } &
  ({ data: Record<string, unknown> } | { data: string; discriminator?: string; decodeError?: string });
export interface EventBatch { events: DecodedEvent[]; truncated: boolean }

// #region ep5-event-parse
function decodeData(encoded: string, idl: Idl) {
  let name = 'unknown';
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('invalid base64');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 8) throw new Error('need 8 event discriminator bytes');
    const discriminator = bytes.subarray(0, 8).toString('hex');
    const entry = idl.events?.find(e => Buffer.from(e.discriminator).equals(bytes.subarray(0, 8)));
    if (!entry) return { name, data: encoded, discriminator };
    name = entry.name;
    const reader = new Reader(bytes.subarray(8));
    const data = decodeType({ defined: { name } }, reader, idl) as Record<string, unknown>;
    if (reader.remaining) throw new Error(`trailing event bytes: ${reader.remaining}`);
    return { name, data };
  } catch (error) {
    return { name, data: encoded, decodeError: error instanceof Error ? error.message : String(error) };
  }
}
// #endregion

export function decodeEvents(rpcTx: RpcTransaction, idl: Idl): EventBatch {
  const logs = rpcTx.meta?.logMessages ?? [];
  const result: EventBatch = { events: [], truncated: logs.some(log => log === 'Log truncated') };
  // 失败交易的所有状态修改回滚；日志可能已经 emit，不能把它当作已发生的余额变化。
  if (rpcTx.meta?.err != null) return result;
  // #region ep5-log-stack
  const stack: string[] = [];
  let ixIndex = -1;
  for (const [logIndex, log] of logs.entries()) {
    if (log === 'Log truncated') break;
    const invoke = /^Program (\S+) invoke \[(\d+)\]$/.exec(log);
    if (invoke) {
      const depth = Number(invoke[2]);
      if (depth === 1) ixIndex++;
      stack.length = depth - 1; stack.push(invoke[1]);
      continue;
    }
    const exit = /^Program (\S+) (?:success|failed:.*)$/.exec(log);
    if (exit) {
      if (stack.at(-1) === exit[1]) stack.pop();
      continue;
    }
    if (stack.at(-1) !== idl.address || !log.startsWith('Program data: ')) continue;
    result.events.push({ signature: rpcTx.transaction.signatures[0], ixIndex, logIndex,
      ...decodeData(log.slice('Program data: '.length), idl) });
  }
  // #endregion
  return result;
}
