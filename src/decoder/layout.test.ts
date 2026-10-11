/**
 * INPUT: 固定 IDL、原始账户 fixture 与合成 C 结构。
 * OUTPUT: 结构大小、显式对齐、隐式 padding 的断言。
 * POSITION: EP5 布局测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../fixtures/m1-accounts.json';
import { marginfiIdl, type Idl } from './idl';
import { layout } from './layout';

test('四种账户布局长度与七份原始字节一致，WrappedI80F48 对齐 8', () => {
  const names: Record<string, string> = { bank: 'Bank', marginfiAccount: 'MarginfiAccount', marginfiGroup: 'MarginfiGroup', feeState: 'FeeState' };
  for (const account of Object.values(fixture.accounts)) {
    const result = layout(names[account.type], marginfiIdl);
    assert.equal(result.size + 8, Buffer.from(account.data, 'base64').length);
    assert.equal(result.align, 8);
  }
  assert.equal(layout('WrappedI80F48', marginfiIdl).align, 8);
  assert.equal(layout('WrappedI80F48', marginfiIdl).size, 16);
});
test('C 结构成员与尾部按对齐补齐；数组 stride 包含元素尾部 padding', () => {
  const idl: Idl = { address: '', instructions: [], types: [
    { name: 'Small', repr: { kind: 'c' }, type: { kind: 'struct', fields: [{ name: 'a', type: 'u32' }, { name: 'b', type: 'u8' }] } },
    { name: 'Outer', repr: { kind: 'c', align: 16 }, type: { kind: 'struct', fields: [
      { name: 'tag', type: 'u8' }, { name: 'items', type: { array: [{ defined: { name: 'Small' } }, 2] } },
    ] } },
  ] };
  const result = layout('Outer', idl);
  assert.equal(result.fields![1].offset, 4); assert.equal(result.fields![1].padding, 3);
  assert.equal(result.fields![1].size, 16); assert.equal(result.size, 32); assert.equal(result.tailPadding, 12);
  assert.throws(() => layout('Missing', idl), /Missing/);
  assert.throws(() => layout('string', idl), /fixed|固定/);
});
