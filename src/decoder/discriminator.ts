/**
 * INPUT: 指令名称或 IDL。
 * OUTPUT: instructionDiscriminator / verifyDiscriminators。
 * POSITION: Anchor 指令前 8 字节的身份校验。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { createHash } from 'node:crypto';
import type { Idl } from './idl';

// #region ep4-discriminator
export function instructionDiscriminator(name: string): Buffer {
  // Anchor 哈希 Rust 的 snake_case 入口名；8 字节不是参数的一部分。
  const snakeCase = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return createHash('sha256').update(`global:${snakeCase}`).digest().subarray(0, 8);
}

export function verifyDiscriminators(idl: Idl): void {
  for (const instruction of idl.instructions) {
    if (!instructionDiscriminator(instruction.name).equals(Buffer.from(instruction.discriminator))) {
      throw new Error(`IDL discriminator mismatch: ${instruction.name}`);
    }
  }
}
// #endregion
