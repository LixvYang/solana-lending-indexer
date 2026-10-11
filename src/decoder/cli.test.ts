/**
 * INPUT: 本地 CLI 子进程与 fixture 签名。
 * OUTPUT: JSON 输出、错误退出和任意当前目录断言。
 * POSITION: EP4 演示入口验收测试。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { run } from './test-utils';

const loader = createRequire(resolve('package.json')).resolve('tsx');
const script = resolve('scripts/decode-tx.ts');
function command(args: string[]) {
  return spawnSync(process.execPath, ['--import', loader, script, ...args], { cwd: tmpdir(), encoding: 'utf8' });
}

test('CLI 从本地 fixture 打印 JSON，bigint 为字符串，运行不依赖当前目录', () => {
  const step = run.steps.find(step => step.label === 'bob borrow 5000 tUSDC')!;
  const result = command([step.signatures[0]]);
  assert.equal(result.status, 0, result.stderr);
  const [ix] = JSON.parse(result.stdout);
  assert.equal(ix.name, 'lending_account_borrow'); assert.equal(ix.args.amount, '5000000000');
  assert.equal(ix.signature, step.signatures[0]); assert.equal(ix.accounts.signer, run.addresses.actors.bob);
  assert.equal(result.stderr, '');
});

test('CLI 缺少参数或签名不在 fixture 时非零退出，不回退到 RPC', () => {
  const missing = command([]); assert.equal(missing.status, 1); assert.match(missing.stderr, /用法/);
  const unknown = command(['not-in-fixture']); assert.equal(unknown.status, 1); assert.match(unknown.stderr, /fixture/);
  assert.equal(unknown.stdout, '');
});
