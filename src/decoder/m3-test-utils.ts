/**
 * INPUT: Anchor 值、M3 解码结果、本地账户 fixture。
 * OUTPUT: 独立比较的标准化和 fixture 账户加载。
 * POSITION: 仅测试辅助，不进入运行时解码器。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import anchor from '@coral-xyz/anchor';
import fixture from '../../fixtures/m1-accounts.json';
import { decodeAccount } from './account';
import { marginfiIdl } from './idl';
export function normalize(value: unknown, camel = false): unknown {
  if (anchor.BN.isBN(value) || typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'toBase58' in value) return (value as { toBase58(): string }).toBase58();
  if (Array.isArray(value)) return value.map(v => normalize(v, camel));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => k !== 'decimal').map(([k, v]) => [camel ? k.replace(/^_+/, '').replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()) : k, normalize(v, camel)]));
  return value;
}
export function fixtureAccounts() {
  return Object.fromEntries(Object.entries(fixture.accounts).map(([address, account]) => [address,
    decodeAccount(Buffer.from(account.data, 'base64'), marginfiIdl)]));
}
