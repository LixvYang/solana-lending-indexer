import type { Context } from '../lib/context';
import { initFeeState, initGroup } from '../lib/marginfi';
import { send } from '../lib/rpc';

export async function step(ctx: Context): Promise<void> {
  // 来源: tests/rootHooks.ts；新部署的程序先创建 FeeState，否则 group initialize 无法通过。
  // 已存在的全局费用由 preflight 读取，剧本不替程序管理员改全局配置。
  if (!await ctx.provider.connection.getAccountInfo(ctx.feeState))
    await send(ctx, 'init global fee state', [await initFeeState(ctx)]);
  await send(ctx, 'create group', [await initGroup(ctx)], [ctx.actors.group]);
}
