/** INPUT: ANCHOR_WALLET/FAUCET_KEYPAIR/RPC_URL。 OUTPUT: 专用钱包文件与一次性补币。 POSITION: EP8 管理员 CLI，API 不导入。 SYNC: folder.md。 */
import 'dotenv/config';
import { existsSync, writeFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { createActors } from '../scenario/lib/actors';
import { nativeAmount } from '../src/faucet/config';
import { setupInstructions } from '../src/faucet/setup';
import { cliRpc, readKeypair, sendInstructions } from './admin-runtime';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: faucet-setup [--top-up] (需要管理员钱包，仅 devnet)'); return; }
  if (args.length && (args.length !== 1 || args[0] !== '--top-up')) throw Error('invalid arguments');
  const path = process.env.FAUCET_KEYPAIR;
  if (!path) throw Error('faucet keypair path required');
  const admin = readKeypair(process.env.ANCHOR_WALLET), rpc = cliRpc();
  if (existsSync(path) && !args.length) { console.log('专用钱包已存在；补充请使用 --top-up。'); return; }
  const faucet = existsSync(path) ? readKeypair(path) : Keypair.generate();
  if (!existsSync(path)) writeFileSync(path, JSON.stringify([...faucet.secretKey]), { flag: 'wx', mode: 0o600 });
  const actors = createActors(), instructions = setupInstructions(admin.publicKey, faucet.publicKey,
    nativeAmount(process.env.FAUCET_SETUP_SOL ?? '2', 9), [
      { label: 'tUSDC', mint: actors.mints.tUSDC.publicKey, amount: nativeAmount(process.env.FAUCET_SETUP_TUSDC ?? '2000000', 6) },
      { label: 'tSOL', mint: actors.mints.tSOL.publicKey, amount: nativeAmount(process.env.FAUCET_SETUP_TSOL ?? '20000', 9) },
    ]);
  console.log(await sendInstructions(rpc, admin, instructions));
}
void main().catch(() => { console.error('faucet setup failed; check configuration, use --top-up to retry'); process.exitCode = 1; });
