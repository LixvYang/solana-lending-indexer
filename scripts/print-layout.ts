/**
 * INPUT: CLI IDL 类型名。
 * OUTPUT: 结构偏移表（不含 discriminator）、成员/尾部 padding。
 * POSITION: EP5 离线布局演示。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import { layout } from '../src/decoder/layout';
import { marginfiIdl } from '../src/decoder/idl';
const [name, ...extra] = process.argv.slice(2);
if (!name || extra.length) {
  console.error('用法: pnpm exec node --import tsx scripts/print-layout.ts <类型名>'); process.exit(1);
}
try {
  const result = layout(name, marginfiIdl);
  console.log(`${name}: size=${result.size} align=${result.align} (账户字节还需 +8 discriminator)`);
  console.log('field\toffset\tsize\talign\tpreviousEnd\tpadding');
  for (const f of result.fields ?? []) console.log(`${f.name}\t${f.offset}\t${f.size}\t${f.align}\t${f.previousEnd}\t${f.padding}`);
  console.log(`tailPadding=${result.tailPadding ?? 0}`);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
