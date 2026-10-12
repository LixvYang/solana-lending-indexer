/** INPUT: ANCHOR_WALLET/RPC_URL、--interval 秒。 OUTPUT: 价格时间戳维护。 POSITION: EP8 独立管理员进程。 SYNC: folder.md。 */
import 'dotenv/config';
import { mocksProgram } from '../scenario/lib/mock-feed';
import { refreshPrices } from '../src/keeper/price';
import { keeperLoop, intervalMs } from '../src/keeper/loop';
import { cliRpc, readKeypair, sendInstructions } from './admin-runtime';
import { realClock } from '../src/api/wallet-rpc';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: price-keeper [--interval 秒] (默认 60)'); return; }
  const interval = intervalMs(args), admin = readKeypair(process.env.ANCHOR_WALLET), rpc = cliRpc(), program = mocksProgram();
  let stopped = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopped = true; });
  process.exitCode = await keeperLoop(() => refreshPrices(rpc, program, async value => {
    await sendInstructions(rpc, admin, [value.instruction], [value.signer]);
  }), realClock.sleep, interval, () => stopped);
}
void main().catch(() => { console.error('price keeper startup failed; check configuration'); process.exitCode = 1; });
