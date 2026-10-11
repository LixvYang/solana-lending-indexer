/**
 * INPUT: IDL 里全部带参数的指令，确定性伪随机参数，测试专用 Anchor 编码器。
 * OUTPUT: 对每个指令：Anchor 编码 → 我们解码 → 参数逐字段一致。
 * POSITION: 补足真实 fixture 只覆盖 18 条指令的缺口(其余指令没有链上样本)。
 * SYNC: 修改时同步 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import rawIdl from './idl/marginfi.idl.json';
import { encodeBase58 } from '../core/base58';
import { decodeInstruction } from './instruction';
import { marginfiIdl, type IdlType } from './idl';

// 确定性伪随机(mulberry32)：失败时可复现。
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(type: IdlType, random: () => number): unknown {
  const int = (bytes: number) => {
    let v = 0n;
    for (let i = 0; i < bytes; i++) v = (v << 8n) | BigInt(Math.floor(random() * 256));
    return v;
  };
  if (typeof type === 'string') {
    if (type === 'bool') return random() < 0.5;
    if (type === 'pubkey') return new PublicKey(Uint8Array.from({ length: 32 }, () => Math.floor(random() * 256)));
    const m = /^([ui])(\d+)$/.exec(type);
    if (!m) throw new Error(`测试生成器不支持类型 ${type}`);
    const bits = BigInt(m[2]);
    const raw = int(Number(bits) / 8);
    // 有符号数：把最高位当符号位，覆盖负数。
    const value = m[1] === 'i' && raw >> (bits - 1n) ? raw - (1n << bits) : raw;
    return bits <= 32n ? Number(value) : new anchor.BN(value.toString());
  }
  if ('option' in type) return random() < 0.5 ? null : generate(type.option, random);
  if ('vec' in type) return Array.from({ length: 1 + Math.floor(random() * 3) }, () => generate(type.vec, random));
  if ('array' in type) return Array.from({ length: type.array[1] }, () => generate(type.array[0], random));
  const definition = marginfiIdl.types!.find(t => t.name === type.defined.name)!;
  if (definition.type.kind === 'struct') {
    const fields = definition.type.fields ?? [];
    return Object.fromEntries(fields.map((f, i) => typeof f === 'object' && 'name' in f
      ? [f.name, generate(f.type, random)] : [String(i), generate(f as IdlType, random)]));
  }
  const variant = definition.type.variants[Math.floor(random() * definition.type.variants.length)];
  const fields = variant.fields ?? [];
  return { [variant.name]: Object.fromEntries(fields.map((f, i) => typeof f === 'object' && 'name' in f
    ? [f.name, generate(f.type, random)] : [String(i), generate(f as IdlType, random)])) };
}

function normalize(value: unknown): unknown {
  if (anchor.BN.isBN(value) || typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}

test('全部带参数的指令：Anchor 编码后由我们解码，参数逐字段一致', () => {
  const coder = new anchor.BorshCoder(rawIdl as anchor.Idl);
  const withArgs = marginfiIdl.instructions.filter(ix => ix.args.length > 0);
  assert.equal(withArgs.length, 23);
  for (const ix of withArgs) {
    for (let round = 0; round < 20; round++) { // 每个指令 20 组随机参数，option 的 Some/None 都会出现
      const random = rng(round * 1000 + ix.name.length);
      const args = Object.fromEntries(ix.args.map(a => [a.name, generate(a.type, random)]));
      const data = encodeBase58(coder.instruction.encode(ix.name, args));
      const keys = Array.from({ length: 40 }, (_, i) => String(i));
      const decoded = decodeInstruction({ programIdIndex: 0, accounts: ix.accounts.length > 0 ? keys.map((_, i) => i) : [], data },
        keys, marginfiIdl);
      assert.ok('args' in decoded, `${ix.name}: ${JSON.stringify(decoded, (_, v) => typeof v === 'bigint' ? String(v) : v)}`);
      assert.equal(decoded.name, ix.name);
      assert.deepEqual(normalize(decoded.args), normalize(args), `${ix.name} round ${round}`);
    }
  }
});
