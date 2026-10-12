import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { expand, extractRegion } from './snapshot-docs';

const source = ['function f() {', '  // #region demo', '  const a = 1;', '    const b = 2;', '  // #endregion', '}'].join('\n');

test('extractRegion 取出区域并去掉公共缩进', () => {
  assert.equal(extractRegion(source, 'demo'), 'const a = 1;\n  const b = 2;');
});

test('找不到区域或缺少 #endregion 时报错，不静默', () => {
  assert.throws(() => extractRegion(source, 'nope'), /找不到区域/);
  assert.throws(() => extractRegion('// #region x\ncode', 'x'), /没有 #endregion/);
});

test('expand 幂等：占位符 → 代码块 → 再展开不变；源码变了会刷新', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'snap-')), 'a.ts');
  writeFileSync(file, source);
  const once = expand(`标题\n{{ snippet ${file}#demo }}\n结尾`);
  assert.match(once, /```ts\nconst a = 1;/);
  assert.equal(expand(once), once);
  writeFileSync(file, source.replace('a = 1', 'a = 99'));
  assert.match(expand(once), /const a = 99;/);
});
