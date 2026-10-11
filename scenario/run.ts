import { parseArgs, printPlan } from './plan';

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  printPlan(options.runId);
  if (!options.execute) return;
  // 延迟加载将 dotenv、RPC、钱包、Switchboard 和 IDL 完全留在 --execute 分支。
  const { config } = await import('dotenv');
  config();
  const { execute } = await import('./execute');
  await execute(options.runId);
}

main().catch(error => {
  const cause = error instanceof Error && error.cause ? ` (cause: ${String(error.cause)})` : '';
  console.error((String(error) + cause).replace(/([?&]api-key=)[^\s&"']+/gi, '$1[REDACTED]'));
  process.exitCode = 1;
});
