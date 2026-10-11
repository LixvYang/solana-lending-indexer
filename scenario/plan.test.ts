import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs, printPlan } from './plan';

test('默认只打印固定顺序与成本，参数错误不能打开执行开关', () => {
  assert.equal(parseArgs([]).execute, false);
  assert.equal(parseArgs(['--execute']).execute, true);
  assert.deepEqual(parseArgs(['--run-id', 'take-2']), { execute: false, runId: 'take-2' });
  assert.throws(() => parseArgs(['--execut']), /未知参数/);
  assert.throws(() => parseArgs(['--run-id']), /run-id/);
  const lines: string[] = [];
  printPlan('', line => lines.push(line));
  const output = lines.join('\n');
  assert.match(output, /SOL/);
  assert.match(output, /--execute/);
  assert.match(output, /5,000 tUSDC/);
  assert.match(output, /50/);
  assert.deepEqual(lines.filter(line => /^\d+\./.test(line)).map(line => Number(line.split('.')[0])),
    Array.from({ length: 13 }, (_, i) => i));
});

test('入口默认模式不需要 RPC、钱包和构建产物，不生成输出文件', t => {
  const directory = mkdtempSync(join(tmpdir(), 'scenario-plan-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const loader = createRequire(resolve('package.json')).resolve('tsx');
  const result = spawnSync(process.execPath, ['--import', loader,
    resolve('scenario/run.ts')], { cwd: directory, encoding: 'utf8',
    env: { ...process.env, RPC_URL: '', ANCHOR_WALLET: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /仅打印计划/);
  assert.match(result.stdout, /12\./);
  assert.deepEqual(readdirSync(directory), []);
});
