/**
 * INPUT: 手写 base58 与独立已知向量。
 * OUTPUT: 前导零、空数据、非法字符的离线断言。
 * POSITION: base58 边界回归测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeBase58, decodeBase58 } from './base58';

test('base58 保留前导零和空输入，拒绝非字母表字符', () => {
  for (const [hex, encoded] of [['', ''], ['00', '1'], ['000001', '112'],
    ['61', '2g'], ['626262', 'a3gV'], ['68656c6c6f20776f726c64', 'StV1DL6CwTryKyV']]) {
    assert.equal(encodeBase58(Buffer.from(hex, 'hex')), encoded);
    assert.equal(Buffer.from(decodeBase58(encoded)).toString('hex'), hex);
  }
  assert.equal(encodeBase58(new Uint8Array(32)), '11111111111111111111111111111111');
  assert.throws(() => decodeBase58('0OIl'), /base58/);
});
