/**
 * INPUT: decodeType、固定 IDL 与合成类型。
 * OUTPUT: 原始字节到参数/浮点值的离线断言。
 * POSITION: IDL 类型解码回归测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reader } from '../core/reader';
import { decodeType } from './borsh';
import { marginfiIdl, type Idl, type IdlType } from './idl';

test('IDL 整数的所有位宽与负号，u8 也返回 bigint', () => {
  for (const bits of [8, 16, 32, 64, 128]) {
    assert.equal(decodeType(`u${bits}` as IdlType, new Reader(Buffer.alloc(bits / 8, 255)), marginfiIdl), (1n << BigInt(bits)) - 1n);
    assert.equal(decodeType(`i${bits}` as IdlType, new Reader(Buffer.alloc(bits / 8, 255)), marginfiIdl), -1n);
    const minimum = Buffer.alloc(bits / 8); minimum[minimum.length - 1] = 128;
    assert.equal(decodeType(`i${bits}` as IdlType, new Reader(minimum), marginfiIdl), -(1n << BigInt(bits - 1)));
  }
});

test('长度前缀、option、vec、array、bytes 与 string', () => {
  const decode = (type: IdlType, bytes: number[]) => decodeType(type, new Reader(Buffer.from(bytes)), marginfiIdl);
  assert.equal(decode('bool', [1]), true);
  assert.equal(decode('pubkey', Array(32).fill(0)), '11111111111111111111111111111111');
  assert.equal(decode('string', [2, 0, 0, 0, 104, 105]), 'hi');
  assert.deepEqual(decode('bytes', [2, 0, 0, 0, 0, 255]), [0, 255]);
  assert.equal(decode({ option: 'u16' }, [0]), null);
  assert.equal(decode({ option: 'u16' }, [1, 52, 18]), 0x1234n);
  assert.deepEqual(decode({ vec: { option: 'u8' } }, [2, 0, 0, 0, 0, 1, 9]), [null, 9n]);
  assert.deepEqual(decode({ array: ['u16', 2] }, [1, 0, 2, 0]), [1n, 2n]);
  assert.throws(() => decode({ option: 'u8' }, [2]), /option/);
  assert.throws(() => decode({ vec: 'u8' }, [255, 255, 255, 255]), /offset/);
  assert.throws(() => decode('bytes', [5, 0, 0, 0, 1]), /offset/);
});

test('defined 结构体与枚举支持命名/元组字段，WrappedI80F48 保留 16 个字节', () => {
  const idl: Idl = { address: '', instructions: [], types: [
    { name: 'Tuple', type: { kind: 'struct', fields: ['i8', 'bool'] } },
    { name: 'Choice', type: { kind: 'enum', variants: [
      { name: 'Empty' }, { name: 'Named', fields: [{ name: 'amount', type: 'u16' }] },
      { name: 'Tuple', fields: ['u8', { defined: { name: 'Tuple' } }] },
    ] } },
  ] };
  const decode = (bytes: number[]) => decodeType({ defined: { name: 'Choice' } }, new Reader(Buffer.from(bytes)), idl);
  assert.deepEqual(decode([0]), { Empty: {} });
  assert.deepEqual(decode([1, 52, 18]), { Named: { amount: 0x1234n } });
  assert.deepEqual(decode([2, 5, 255, 1]), { Tuple: { '0': 5n, '1': { '0': -1n, '1': true } } });
  assert.throws(() => decode([3]), /enum/);
  const bytes = Array.from({ length: 16 }, (_, i) => i);
  assert.deepEqual(decodeType({ defined: { name: 'WrappedI80F48' } }, new Reader(Buffer.from(bytes)), marginfiIdl), { value: bytes });
  assert.throws(() => decodeType({ defined: { name: 'Missing' } }, new Reader(Buffer.alloc(0)), idl), /Missing/);
});

test('Borsh f32/f64 为 IEEE754 小端浮点数，保留链上 f64 原值', () => {
  const bytes = Buffer.alloc(12); bytes.writeFloatLE(-1.25); bytes.writeDoubleLE(5512499999.999999, 4);
  const reader = new Reader(bytes);
  assert.equal(decodeType('f32', reader, marginfiIdl), -1.25);
  assert.equal(decodeType('f64', reader, marginfiIdl), 5512499999.999999);
  assert.throws(() => decodeType('f64', new Reader(Buffer.alloc(7)), marginfiIdl), /offset/);
});
