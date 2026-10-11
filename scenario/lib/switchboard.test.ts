import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LegacyCrossbarClient } from '@switchboard-xyz/common-legacy';
import { PublicKey } from '@solana/web3.js';
import { storePrice } from './switchboard';
import { rebuildInstruction, SWITCHBOARD_PROGRAM, SWITCHBOARD_QUEUE } from './switchboard-client';

test('固定价必须经过 Crossbar v1 store 并用 v1 fetch 核对，测试不访问网络', async t => {
  const hash = 'ab'.repeat(32);
  let fetched = '';
  t.mock.method(LegacyCrossbarClient.prototype, 'store', async (queue: string, jobs: any[]) => {
    assert.equal(queue, SWITCHBOARD_QUEUE);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].tasks[0].valueTask.value, 50);
    return { feedHash: `0x${hash}` };
  });
  t.mock.method(LegacyCrossbarClient.prototype, 'fetch', async (feedHash: string) => {
    fetched = feedHash;
    return { jobs: [{ tasks: [{ valueTask: { value: 50 } }] }] };
  });
  assert.equal((await storePrice(50)).toString('hex'), hash);
  assert.equal(fetched, hash);
  await assert.rejects(storePrice(0), /无效价格/);
});

test('外部指令只用地址、字节重建，数据改动不会穿过 SDK 边界', () => {
  const data = new Uint8Array([1, 2, 3]);
  const ix = rebuildInstruction({ programId: { toBase58: () => SWITCHBOARD_PROGRAM },
    keys: [{ pubkey: { toBase58: () => SWITCHBOARD_QUEUE }, isSigner: false, isWritable: true }], data });
  data[0] = 9;
  assert.ok(ix.programId instanceof PublicKey);
  assert.ok(ix.keys[0].pubkey instanceof PublicKey);
  assert.deepEqual([...ix.data], [1, 2, 3]);
});
