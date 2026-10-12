/**
 * 把章节文档里的 `{{ snippet 路径#区域名 }}` 展开成真实代码，并保持与源码同步。
 *
 *   pnpm exec tsx scripts/snapshot-docs.ts          # 展开/刷新 docs/chapters/*.md
 *   pnpm exec tsx scripts/snapshot-docs.ts --check  # 只检查：有过期或找不到的片段就退出码 1(适合 CI)
 *
 * 为什么这样做：教程里手贴的代码一定会腐烂。源码里用 `// #region 名字` … `// #endregion` 划出教学片段，
 * 文档只写引用，由本脚本生成。代码改了，重跑一次文档就跟着变；区域被删或改名，--check 立刻报错。
 *
 * 第一次运行会把 `{{ snippet … }}` 替换成带标记的代码块，之后每次只刷新标记之间的内容：
 *   <!-- snippet: src/x.ts#region -->
 *   ```ts
 *   …
 *   ```
 *   <!-- /snippet -->
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const LANG: Record<string, string> = { '.ts': 'ts', '.tsx': 'tsx', '.sql': 'sql', '.sh': 'bash', '.json': 'json' };
const OPEN = /<!-- snippet: (\S+?)#(\S+?) -->/;

/** 取出源码里 `#region 名` 到 `#endregion` 之间的行，去掉公共缩进。 */
export function extractRegion(source: string, region: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => new RegExp(`#region ${region}\\s*$`).test(l));
  if (start < 0) throw new Error(`找不到区域 #region ${region}`);
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (/#endregion/.test(lines[i])) { end = i; break; }
  if (end < 0) throw new Error(`区域 ${region} 没有 #endregion`);
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length), Infinity);
  return body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').replace(/\s+$/, '');
}

function block(path: string, region: string): string {
  const code = extractRegion(readFileSync(path, 'utf8'), region);
  const lang = LANG[extname(path)] ?? '';
  return `<!-- snippet: ${path}#${region} -->\n\`\`\`${lang}\n${code}\n\`\`\`\n<!-- /snippet -->`;
}

export function expand(markdown: string): string {
  // 1) 首次：占位符 → 带标记的代码块
  let out = markdown.replace(/\{\{ snippet (\S+?)#(\S+?) \}\}/g, (_, path, region) => block(path, region));
  // 2) 刷新：已有标记块按源码重新生成
  out = out.replace(/<!-- snippet: (\S+?)#(\S+?) -->[\s\S]*?<!-- \/snippet -->/g, (_, path, region) => block(path, region));
  return out;
}

// 只在直接运行时执行(被测试 import 时不执行)。
if (process.argv[1]?.endsWith('snapshot-docs.ts')) {
  const check = process.argv.includes('--check');
  const dir = 'docs/chapters';
  let stale = 0, failed = 0, count = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const file = join(dir, name);
    const before = readFileSync(file, 'utf8');
    let after: string;
    try { after = expand(before); } catch (error) { console.error(`✗ ${file}: ${(error as Error).message}`); failed++; continue; }
    count += (before.match(OPEN) ? before.match(new RegExp(OPEN, 'g'))!.length : 0) + (before.match(/\{\{ snippet /g)?.length ?? 0);
    if (after !== before) { stale++; if (check) console.error(`✗ ${file}: 片段已过期，运行 pnpm exec tsx scripts/snapshot-docs.ts`); else writeFileSync(file, after); }
  }
  console.log(`${check ? '检查' : '展开'}完成：${count} 个片段，${stale} 个${check ? '过期' : '已更新'}，${failed} 个失败`);
  if (failed || (check && stale)) process.exit(1);
}
