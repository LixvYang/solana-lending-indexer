/** INPUT: CLI 子进程与参数。 OUTPUT: 无网络参数/帮助验证。 POSITION: EP6 CLI 测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseIngestArgs } from '../../scripts/ingest-options';
const loader = createRequire(resolve('package.json')).resolve('tsx');
test('ingest accepts exactly one mode and valid inclusive from/once only for tail', () => {
  assert.deepEqual(parseIngestArgs(['--backfill']), { mode: 'backfill', once: false });
  assert.deepEqual(parseIngestArgs(['--follow']), { mode: 'follow', once: false });
  assert.deepEqual(parseIngestArgs(['--follow', '--once']), { mode: 'follow', once: true });
  for (const args of [['--follow', '--from', '1'], ['--follow', '--to', '1'], ['--follow', '--tail']]) assert.throws(() => parseIngestArgs(args), /用法/);
  assert.deepEqual(parseIngestArgs(['--tail', '--once', '--from', '42']), { mode: 'tail', once: true, from: 42 });
  for (const args of [[], ['--tail','--backfill'], ['--backfill','--once'], ['--backfill','--from','1'], ['--tail','--from','-1'], ['--tail','--from','abc'], ['--tail','--from'], ['--tail','--other'], ['--tail','--from','9007199254740992']]) assert.throws(() => parseIngestArgs(args), /用法|slot/);
});
test('CLI help and invalid args exit before database/RPC access, from arbitrary cwd', () => {
  for (const script of ['migrate', 'reindex', 'ingest']) {
    const result = spawnSync(process.execPath, ['--import', loader, resolve(`scripts/${script}.ts`), '--help'], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, RPC_URL: '', DATABASE_URL: 'invalid' } });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /用法/);
    const bad = spawnSync(process.execPath, ['--import', loader, resolve(`scripts/${script}.ts`), '--bad'], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(bad.status, 1); assert.match(bad.stderr, /用法/);
  }
});
