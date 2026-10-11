/**
 * INPUT: 七份原始账户、固定 IDL、测试专用 Anchor coder。
 * OUTPUT: 所有字段及损坏输入的独立断言。
 * POSITION: EP5 账户解码验收。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import anchor from '@coral-xyz/anchor';
import fixture from '../../fixtures/m1-accounts.json';
import rawIdl from './idl/marginfi.idl.json';
import { marginfiIdl } from './idl';
import { decodeAccount } from './account';
import { layout } from './layout';
import { normalize } from './m3-test-utils';

test('七个账户逐字段与 PascalCase / snake_case Anchor accounts coder 一致', () => {
  const coder = new anchor.BorshCoder(rawIdl as anchor.Idl);
  assert.equal(Object.keys(fixture.accounts).length, 7);
  for (const account of Object.values(fixture.accounts)) {
    const bytes = Buffer.from(account.data, 'base64'), before = Buffer.from(bytes);
    const decoded = decodeAccount(bytes, marginfiIdl);
    assert.ok('data' in decoded && !('decodeError' in decoded));
    assert.deepEqual(normalize(decoded.data), normalize(coder.accounts.decode(decoded.name, bytes)), account.type);
    assert.deepEqual(bytes, before);
  }
});
test('账户长度严格相等，未知 discriminator、坏 bool/enum 不抛到调用者', () => {
  const bytes = Buffer.from(Object.values(fixture.accounts)[0].data, 'base64');
  for (const bad of [bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.alloc(1)]), bytes.subarray(0, 4)]) {
    assert.ok('decodeError' in decodeAccount(bad, marginfiIdl));
  }
  const unknown = Buffer.alloc(8, 255);
  assert.equal(decodeAccount(unknown, marginfiIdl).name, 'unknown');
  const user = Buffer.from(Object.values(fixture.accounts).find(a => a.type === 'marginfiAccount')!.data, 'base64');
  user[8 + 64] = 2;
  assert.match((decodeAccount(user, marginfiIdl) as { decodeError: string }).decodeError, /bool/);
  const bank = Buffer.from(Object.values(fixture.accounts).find(a => a.type === 'bank')!.data, 'base64');
  const config = layout('Bank', marginfiIdl).fields!.find(f => f.name === 'config')!.offset;
  const state = layout('BankConfig', marginfiIdl).fields!.find(f => f.name === 'operational_state')!.offset;
  bank[8 + config + state] = 255;
  assert.match((decodeAccount(bank, marginfiIdl) as { decodeError: string }).decodeError, /enum/);
});
