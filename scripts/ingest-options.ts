/** INPUT: CLI 参数。 OUTPUT: parseIngestArgs。 POSITION: EP6 无副作用参数入口。 SYNC: 同步 folder.md。 */
export const ingestUsage = '用法: ingest --backfill | --tail [--once] [--from <slot>] [--to <slot>]';
export function parseIngestArgs(args: string[]): { mode: 'backfill' | 'tail'; once: boolean; from?: number; to?: number } {
  let mode: 'backfill' | 'tail' | undefined, once = false, from: number | undefined, to: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--backfill' || arg === '--tail') {
      if (mode) throw new Error(ingestUsage);
      mode = arg === '--tail' ? 'tail' : 'backfill';
    } else if (arg === '--once' && !once) once = true;
    else if (arg === '--from' && from === undefined) {
      const raw = args[++i];
      if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('invalid --from slot; ' + ingestUsage);
      from = Number(raw);
    } else if (arg === '--to' && to === undefined) {
      // 上界用于只扫一小段 slot(验证、重放某次运行)；不加则追到当前 finalized。
      const raw = args[++i];
      if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('invalid --to slot; ' + ingestUsage);
      to = Number(raw);
    } else throw new Error(ingestUsage);
  }
  if (!mode || (mode === 'backfill' && (once || from !== undefined || to !== undefined))) throw new Error(ingestUsage);
  return { mode, once, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}
