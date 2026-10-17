/** INPUT: 真实 devnet Pyth SOL/USD 账户 fixture。 OUTPUT: 字段、变长枚举偏移、坏布局断言。 POSITION: 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNT_SIZE, decodePriceUpdate } from './pyth';

const real = readFileSync('fixtures/pyth-price-update-sol-usd.bin');

test('真实 Pyth 账户:feed id、精确价格与置信区间、Full 校验级别', () => {
  const p = decodePriceUpdate(real);
  assert.equal(real.length, ACCOUNT_SIZE);
  assert.equal(p.feed_id, 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'); // SOL/USD,主网与 devnet 相同
  assert.equal(p.verification, 'Full');
  assert.equal(p.exponent, -8);
  assert.deepEqual([p.price.numerator, p.price.denominator, p.price.decimal], [10470890852n, 100000000n, '104.70890852']);
  assert.equal(p.conf.decimal, '0.04466048');
  assert.equal(p.ema_price.decimal, '104.7573396');
  assert.equal(p.publish_time, 1792221354n);
  assert.equal(p.posted_slot, 511994728n);
});

test('verification_level 是变长枚举:Partial 多 1 字节,后面所有字段都要跟着挪', () => {
  // 把真实账户改写成 Partial { num_signatures: 5 }:标签 0 + 1 字节签名数,消息整体后移 1 字节(用掉尾部的预留字节)。
  const partial = Buffer.concat([real.subarray(0, 40), Buffer.from([0, 5]), real.subarray(41, ACCOUNT_SIZE - 1)]);
  const p = decodePriceUpdate(partial), full = decodePriceUpdate(real);
  assert.equal(p.verification, 'Partial');
  assert.equal(p.num_signatures, 5);
  assert.deepEqual([p.feed_id, p.price.decimal, p.conf.decimal, p.publish_time, p.posted_slot],
    [full.feed_id, full.price.decimal, full.conf.decimal, full.publish_time, full.posted_slot]);
});

test('坏布局直接拒绝:长度、discriminator、未知校验级别', () => {
  assert.throws(() => decodePriceUpdate(real.subarray(0, 133)), /length/);
  const wrong = Buffer.from(real); wrong[0] ^= 1;
  assert.throws(() => decodePriceUpdate(wrong), /discriminator/);
  const tag = Buffer.from(real); tag[40] = 2;
  assert.throws(() => decodePriceUpdate(tag), /verification/);
});
