/** INPUT: 真实 pSOL 银行 fixture、Pyth 地址规则。 OUTPUT: PDA、feed id 换算、各类银行的价格账户断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import fixture from '../../fixtures/pyth-accounts.json';
import { decodeAccount } from '../decoder/account';
import { marginfiIdl } from '../decoder/idl';
import { FEED_IDS, feedIdAsKey, oracleAccountOf, pythPushAccount } from './pyth';

const SOL_USD_ACCOUNT = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'; // devnet 上实际存在、持续更新的赞助账户

test('赞助价格账户 = PDA([分片 u16 LE, feed id], Pyth Push Oracle);分片不同地址就不同', () => {
  assert.equal(pythPushAccount(FEED_IDS['SOL/USD']).toBase58(), SOL_USD_ACCOUNT);
  assert.equal(pythPushAccount(`0x${FEED_IDS['SOL/USD']}`).toBase58(), SOL_USD_ACCOUNT);
  assert.notEqual(pythPushAccount(FEED_IDS['SOL/USD'], 3301).toBase58(), SOL_USD_ACCOUNT); // marginfi 自己赞助的分片
  assert.throws(() => pythPushAccount('abcd'), /32 bytes/);
});

test('真实 pSOL 银行:oracle_keys[0] 存的是 feed id,换算后才是要传的价格账户', () => {
  const address = Object.entries(fixture.names).find(([, n]) => n === 'bank_pSOL')![0];
  const bank = decodeAccount(Buffer.from((fixture.accounts as Record<string, { data: string }>)[address].data, 'base64'), marginfiIdl);
  assert.ok('data' in bank && bank.name === 'Bank');
  const config = (bank.data as unknown as { config: { oracle_setup: unknown; oracle_keys: string[]; oracle_max_age: unknown } }).config;
  assert.deepEqual(config.oracle_setup, { PythPushOracle: {} });
  assert.equal(config.oracle_keys[0], feedIdAsKey(FEED_IDS['SOL/USD']).toBase58());
  assert.notEqual(config.oracle_keys[0], SOL_USD_ACCOUNT); // 直接把 oracle_keys[0] 当账户传会被程序拒绝
  assert.equal(String(config.oracle_max_age), '300');
  assert.equal(oracleAccountOf(config), SOL_USD_ACCOUNT);
});

test('Switchboard/mock 银行原样使用 oracle_keys[0];未配置预言机返回 null', () => {
  const key = new PublicKey(Buffer.alloc(32, 7)).toBase58();
  assert.equal(oracleAccountOf({ oracle_setup: { SwitchboardPull: {} }, oracle_keys: [key] }), key);
  assert.equal(oracleAccountOf({ oracle_setup: { PythPushOracle: {} }, oracle_keys: [PublicKey.default.toBase58()] }), null);
  assert.equal(oracleAccountOf({ oracle_setup: { None: {} }, oracle_keys: [] }), null);
});
