import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ComputeBudgetProgram, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import { offlineContext } from './test-context';
import { send } from './rpc';

test('发送超时前签名已落盘；crank 的 ComputeBudget 最后追加，所有 RPC 方法均替身', async t => {
  const ctx = offlineContext();
  const directory = mkdtempSync(join(tmpdir(), 'scenario-record-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  ctx.outputPath = join(directory, 'run.json');
  let serialized: Uint8Array | undefined;
  t.mock.method(ctx.provider.connection, 'getLatestBlockhash', async () => ({
    blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1,
  }));
  // 此替身不调用原方法、不接触网络；模拟无法判断是否广播成功的 RPC 超时。
  t.mock.method(ctx.provider.connection, 'sendRawTransaction', async (bytes: Uint8Array) => {
    serialized = bytes;
    throw new Error('offline simulated timeout');
  });
  const ix = new TransactionInstruction({ programId: ctx.program.programId, keys: [], data: Buffer.from([1]) });
  await assert.rejects(send(ctx, 'test crank', [ix], [], true), /offline simulated timeout/);
  const record = JSON.parse(readFileSync(ctx.outputPath, 'utf8'));
  assert.match(record.steps[0].signatures[0], /^[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(record.steps[0].slot, null);
  assert.equal(record.steps[0].status, 'signed');
  const transaction = VersionedTransaction.deserialize(serialized!);
  const instructions = transaction.message.compiledInstructions;
  const lastProgram = transaction.message.staticAccountKeys[instructions.at(-1)!.programIdIndex];
  assert.ok(lastProgram.equals(ComputeBudgetProgram.programId));
  assert.ok(transaction.message.staticAccountKeys[instructions[0].programIdIndex].equals(ctx.program.programId));
});
