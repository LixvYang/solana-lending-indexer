/**
 * INPUT: 固定 IDL 与 SHA-256 discriminator。
 * OUTPUT: 全部 36 个指令身份的一致性断言。
 * POSITION: IDL 指令身份交叉校验。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marginfiIdl } from './idl';
import { instructionDiscriminator, verifyDiscriminators } from './discriminator';

test('全部 36 个 IDL discriminator 与 global:snake_case 的 SHA-256 一致', () => {
  assert.equal(marginfiIdl.instructions.length, 36);
  for (const ix of marginfiIdl.instructions) {
    assert.deepEqual([...instructionDiscriminator(ix.name)], ix.discriminator, ix.name);
  }
  verifyDiscriminators(marginfiIdl);
  assert.throws(() => verifyDiscriminators({ ...marginfiIdl, instructions: [
    { ...marginfiIdl.instructions[0], discriminator: Array(8).fill(0) },
  ] }), /discriminator/);
});
