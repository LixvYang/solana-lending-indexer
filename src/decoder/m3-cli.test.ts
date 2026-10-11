/**
 * INPUT: 两个 M3 CLI 子进程、本地账户地址。
 * OUTPUT: JSON、布局表、错误退出与任意当前目录断言。
 * POSITION: EP5 视频演示入口验收。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './test-utils';
const loader = createRequire(resolve('package.json')).resolve('tsx');
function command(script: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', loader, resolve('scripts', script), ...args], { cwd: tmpdir(), encoding: 'utf8' });
}
test('账户 CLI 从 fixture 打印 bigint 和精确 decimal，不依赖 cwd', () => {
  const output = command('decode-account.ts', [run.addresses.banks.tUSDC]);
  assert.equal(output.status, 0, output.stderr); assert.equal(output.stderr, '');
  const account = JSON.parse(output.stdout);
  assert.equal(account.name, 'Bank'); assert.equal(account.data.mint_decimals, '6');
  assert.match(account.data.asset_share_value.decimal, /^1\./);
  assert.equal(account.data.asset_share_value.value.length, 16);
});
test('布局 CLI 打印计算偏移、前一字段结束与 padding', () => {
  const output = command('print-layout.ts', ['FeeState']);
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stdout, /offset.*size.*align.*previousEnd.*padding/);
  assert.match(output.stdout, /FeeState.*size=256.*align=8/);
  assert.match(output.stdout, /program_fee_fixed\s+128\s+16\s+8\s+128\s+0/);
});
test('M3 CLI 缺参数、多参数、未知账户/类型均退出 1，不回退 RPC', () => {
  for (const [script, args] of [['decode-account.ts', []], ['decode-account.ts', ['unknown']],
    ['decode-account.ts', ['a', 'b']], ['print-layout.ts', []], ['print-layout.ts', ['Missing']],
    ['print-layout.ts', ['Bank', 'extra']]] as [string, string[]][]) {
    const output = command(script, args);
    assert.equal(output.status, 1); assert.equal(output.stdout, ''); assert.ok(output.stderr);
  }
});
