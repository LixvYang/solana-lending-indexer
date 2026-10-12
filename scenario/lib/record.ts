import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import anchor, { type Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

const { BN, EventParser } = anchor;

export interface RecordedEvent { signature: string; name: string; data: Record<string, any> }
export interface Receipt {
  step: number; label: string; signatures: string[]; slot: number | null;
  status: 'signed' | 'submitted' | 'confirmed' | 'finalized' | 'failed'; error?: string;
  /** 因 blockhash 过期而没有上链、已用新交易替换的签名(只记录，不算数)。 */
  dropped?: string[];
}
export interface RunRecord {
  startedAt: string; runId: string; status: 'running' | 'complete' | 'failed';
  steps: Receipt[]; addresses: {
    group: string; banks: Record<string, string>; feeds: Record<string, string>;
    mints: Record<string, string>; marginfiAccounts: Record<string, string>;
    actors: Record<string, string>;
  };
  events: RecordedEvent[]; transactions: Record<string, unknown>; snapshots?: unknown; error?: string;
}

export function jsonValue(value: any): any {
  if (BN.isBN(value)) return value.toString(10);
  if (value instanceof PublicKey || typeof value?.toBase58 === 'function') return value.toBase58();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  // 每笔交易覆盖一份完整记录；中途失败时已落链的签名不会只留在终端。
  writeFileSync(`${path}.tmp`, `${JSON.stringify(jsonValue(value), null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

export function parseEvents(program: Program, signature: string, logs: string[]): RecordedEvent[] {
  // 对照基准使用 Anchor，不依赖以后 src/decoder 的实现。
  return [...new EventParser(program.programId, program.coder).parseLogs(logs)].map(event => ({
    // Anchor 0.31 把 IDL 名称转成 camelCase；对外恢复 Rust 事件名，字段保留 camelCase。
    signature, name: event.name[0].toUpperCase() + event.name.slice(1), data: jsonValue(event.data),
  }));
}
