/** INPUT: 离线 fetch 替身。 OUTPUT: finalized 参数、重试、脱敏断言。 POSITION: EP6 RPC 测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rpc, RpcError } from './rpc';
test('RPC retries network errors and 429 with exponential backoff; all methods request finalized', async () => {
  const calls: { method: string; params: unknown[] }[] = [], waits: number[] = [];
  let count = 0;
  const fake: typeof fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string); calls.push(request);
    count++; if (count === 1) throw Error('fetch failed');
    if (count === 2) return new Response('', { status: 429 });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: 100 });
  };
  const rpc = new Rpc('https://example.invalid/?api-key=never-print', { fetch: fake, sleep: async ms => { waits.push(ms); }, delayMs: 2 });
  assert.equal(await rpc.getSlot(), 100); assert.deepEqual(waits, [2, 4]);
  await rpc.getBlocks(1, 2); await rpc.getBlock(1); await rpc.getSignaturesForAddress('program', 'before');
  await rpc.getTransaction('sig'); await rpc.getMultipleAccounts(['account']);
  for (const call of calls) assert.ok(call.params.some(p => typeof p === 'object' && p !== null && (p as { commitment?: string }).commitment === 'finalized'));
  const block = calls.find(c => c.method === 'getBlock')!.params[1];
  assert.deepEqual(block, { commitment: 'finalized', encoding: 'json', transactionDetails: 'full', rewards: false, maxSupportedTransactionVersion: 1 });
  assert.equal((calls.find(c => c.method === 'getTransaction')!.params[1] as Record<string, unknown>).maxSupportedTransactionVersion, 1);
});
test('RPC errors redact raw and encoded API keys including echoed URLs and retain error code', async () => {
  const url = 'https://example.invalid/?api-key=secret%2Bvalue';
  for (const network of [false, true]) {
    const rpc = new Rpc(url, { retries: 0, fetch: async () => {
      if (network) throw Error(`failed ${url} secret+value`);
      return Response.json({ error: { code: -32007, message: `slot skipped ${url} secret+value` } });
    } });
    await assert.rejects(rpc.getBlock(1), error => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /secret/);
      if (!network) assert.equal((error as RpcError).code, -32007);
      return true;
    });
  }
});
test('permanent JSON-RPC errors do not retry and missing result is rejected', async () => {
  let calls = 0;
  const rpc = new Rpc('https://example.invalid', { fetch: async () => { calls++; return Response.json({ error: { code: -32602, message: 'invalid params' } }); } });
  await assert.rejects(rpc.getSlot(), /invalid params/); assert.equal(calls, 1);
  await assert.rejects(new Rpc('https://example.invalid', { retries: 0, fetch: async () => Response.json({}) }).getSlot(), /missing result/);
});
