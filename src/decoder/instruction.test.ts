/**
 * INPUT: 指令/交易入口与手写合成 RPC 数据。
 * OUTPUT: 错误隔离、账户角色、v0 和 CPI 位置断言。
 * POSITION: 指令及 RPC 边界回归测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeBase58 } from '../core/base58';
import { marginfiIdl, type Idl } from './idl';
import { decodeInstruction } from './instruction';
import { decodeTransaction, type RpcTransaction } from './transaction';

const deposit = marginfiIdl.instructions.find(ix => ix.name === 'lending_account_deposit')!;
const data = encodeBase58(Buffer.from([...deposit.discriminator, 42, 0, 0, 0, 0, 0, 0, 0]));
const keys = ['group', 'account', 'signer', 'bank', 'tokenAccount', 'vault', 'tokenProgram'];
const ix = { programIdIndex: 7, accounts: [0, 1, 2, 3, 4, 5, 6], data };

test('未知 discriminator 保留 base64 原始字节', () => {
  const bytes = Buffer.from('ffffffffffffffff0102', 'hex');
  assert.deepEqual(decodeInstruction({ ...ix, data: encodeBase58(bytes) }, [...keys, marginfiIdl.address], marginfiIdl),
    { name: 'unknown', discriminator: 'ffffffffffffffff', data: bytes.toString('base64') });
});

test('不足 8 字节的 discriminator 返回错误并保留原始字节', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from([1, 2, 3])]) {
    const result = decodeInstruction({ ...ix, data: encodeBase58(bytes) }, [...keys, marginfiIdl.address], marginfiIdl);
    assert.equal(result.name, 'unknown'); assert.ok('decodeError' in result);
    assert.match(result.decodeError, /discriminator/); assert.equal(result.data, bytes.toString('base64'));
  }
});

test('截断、非法 base58 与账户越界返回 decodeError，后续指令继续解码', () => {
  const truncated = encodeBase58(Buffer.from([...deposit.discriminator, 42]));
  for (const broken of [{ ...ix, data: truncated }, { ...ix, accounts: [99, ...ix.accounts.slice(1)] },
    { ...ix, accounts: ix.accounts.slice(1) }, { ...ix, programIdIndex: 99 }]) {
    const result = decodeInstruction(broken, [...keys, marginfiIdl.address], marginfiIdl);
    assert.equal(result.name, 'lending_account_deposit'); assert.ok('decodeError' in result);
    assert.equal(result.data, Buffer.from(broken.data === truncated ? [...deposit.discriminator, 42]
      : [...deposit.discriminator, 42, 0, 0, 0, 0, 0, 0, 0]).toString('base64'));
  }
  const invalid = decodeInstruction({ ...ix, data: '0' }, [...keys, marginfiIdl.address], marginfiIdl);
  assert.ok('decodeError' in invalid); assert.equal(invalid.rawData, '0');
  const tx: RpcTransaction = { transaction: { signatures: ['signature'], message: {
    accountKeys: [...keys, marginfiIdl.address], instructions: [{ ...ix, data: truncated }, ix],
  } }, meta: null };
  const results = decodeTransaction(tx, marginfiIdl);
  assert.equal(results.length, 2); assert.ok('decodeError' in results[0]);
  assert.ok('args' in results[1]); assert.equal(results[1].args.amount, 42n);
});

test('嵌套 IDL 账户按叶子顺序展平，多余账户进入 remaining', () => {
  const idl: Idl = { ...marginfiIdl, instructions: [{ ...deposit, accounts: [
    { name: 'grouped', accounts: [{ name: 'marginfi_group' }, { name: 'nested', accounts: [{ name: 'marginfi_account' }] }] },
    { name: 'signer' },
  ] }] };
  const result = decodeInstruction(ix, [...keys, marginfiIdl.address], idl);
  assert.ok('accounts' in result);
  assert.deepEqual(result.accounts, { marginfi_group: 'group', marginfi_account: 'account', signer: 'signer' });
  assert.deepEqual(result.remaining, ['bank', 'tokenAccount', 'vault', 'tokenProgram']);
});

test('v0 地址表按静态 + writable + readonly 拼接，含地址表内的程序地址', () => {
  const tx: RpcTransaction = { transaction: { signatures: ['v0-signature'], message: {
    accountKeys: ['group', 'signer'], instructions: [{ programIdIndex: 7, accounts: [0, 2, 1, 3, 4, 5, 6], data }],
  } }, meta: { loadedAddresses: { writable: ['account', 'bank', 'tokenAccount', 'vault'], readonly: ['tokenProgram', marginfiIdl.address] } } };
  const [result] = decodeTransaction(tx, marginfiIdl);
  assert.ok('accounts' in result);
  assert.deepEqual(result.accounts, { marginfi_group: 'group', marginfi_account: 'account', signer: 'signer',
    bank: 'bank', signer_token_account: 'tokenAccount', bank_liquidity_vault: 'vault', token_program: 'tokenProgram' });
  assert.equal(result.ixIndex, 0); assert.equal(result.innerIndex, null); assert.equal(result.stackHeight, null);
});

test('顶层与 inner 指令均按执行位置输出，保留 innerIndex / stackHeight 并跳过其他程序', () => {
  const tx: RpcTransaction = { transaction: { signatures: ['cpi-signature'], message: {
    accountKeys: [...keys, marginfiIdl.address, 'otherProgram'], instructions: [
      { programIdIndex: 8, accounts: [], data: '' }, { ...ix, stackHeight: 1 },
    ],
  } }, meta: { innerInstructions: [{ index: 0, instructions: [
    { programIdIndex: 8, accounts: [], data: '' }, { ...ix, stackHeight: 3 },
  ] }, { index: 1, instructions: [{ ...ix, stackHeight: 2 }] }] } };
  assert.deepEqual(decodeTransaction(tx, marginfiIdl).map(({ signature, ixIndex, innerIndex, stackHeight }) =>
    ({ signature, ixIndex, innerIndex, stackHeight })), [
    { signature: 'cpi-signature', ixIndex: 0, innerIndex: 1, stackHeight: 3 },
    { signature: 'cpi-signature', ixIndex: 1, innerIndex: null, stackHeight: 1 },
    { signature: 'cpi-signature', ixIndex: 1, innerIndex: 0, stackHeight: 2 },
  ]);
});
