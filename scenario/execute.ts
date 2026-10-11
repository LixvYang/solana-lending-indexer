import { resolve } from 'node:path';
import { createContext, preflight } from './lib/runtime';
import { finalizeRecord } from './lib/rpc';
import { writeJson } from './lib/record';
import { snapshots } from './lib/state';
import { accumulateExpected } from './expected';
import { steps } from './steps';

export async function execute(runId: string) {
  const ctx = await createContext(runId);
  try {
    await preflight(ctx);
    for (const [index, step] of steps.entries()) {
      ctx.step = index + 1;
      await step(ctx);
    }
    await finalizeRecord(ctx);
    ctx.record.snapshots = await snapshots(ctx);
    const expected = accumulateExpected(ctx.record.events);
    for (const action of ['Deposit', 'Borrow', 'Repay', 'Withdraw', 'Liquidate']) {
      if (!ctx.record.events.some(event => event.name === `LendingAccount${action}Event`))
        throw new Error(`Anchor 日志中缺少 ${action} 事件，不能宣称剧本覆盖成功`);
    }
    writeJson(resolve(`scenario/out/expected-${ctx.timestamp}.json`), expected);
    ctx.record.status = 'complete';
    writeJson(ctx.outputPath, ctx.record);
    console.log(`剧本记录：${ctx.outputPath}`);
  } catch (error) {
    ctx.record.status = 'failed'; ctx.record.error = String(error);
    writeJson(ctx.outputPath, ctx.record);
    // 即使后半段失败，也保留已收到事件的 expected，不伪装成完整剧本。
    writeJson(resolve(`scenario/out/expected-${ctx.timestamp}.json`),
      { ...accumulateExpected(ctx.record.events), incomplete: true });
    throw error;
  }
}
