/** INPUT: bigint 边界。 OUTPUT: JSONB 数值无损断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toJson } from './json';
test('JSON decimal strings round trip u64, signed i128 and ordinary strings exactly', () => {
  const source = { u: 2n ** 64n - 1n, i: -(2n ** 127n), values: [0n, 2n ** 96n], text: '00123' };
  const stored = JSON.parse(toJson(source));
  assert.equal(BigInt(stored.u), source.u);
  assert.equal(BigInt(stored.i), source.i);
  assert.deepEqual(stored.values.map(BigInt), source.values);
  assert.equal(stored.text, source.text);
});
import { fromJson } from './json';
import { marginfiIdl } from '../decoder/idl';
import { decodeEvents } from '../decoder/event';
import { decodeAccount } from '../decoder/account';
import { transactions } from '../decoder/test-utils';
import accounts from '../../fixtures/m1-accounts.json';
test('IDL-guided revival preserves bigint types without guessing numeric strings or changing f64/bytes', () => {
  for (const tx of Object.values(transactions)) for (const event of decodeEvents(tx, marginfiIdl).events) {
    if (typeof event.data === 'object') assert.deepEqual(fromJson(JSON.parse(toJson(event.data)), event.name, marginfiIdl), event.data);
  }
  for (const account of Object.values(accounts.accounts)) {
    const decoded = decodeAccount(Buffer.from(account.data, 'base64'), marginfiIdl);
    if ('data' in decoded) assert.deepEqual(fromJson(JSON.parse(toJson(decoded.data)), decoded.name, marginfiIdl), decoded.data);
  }
});
