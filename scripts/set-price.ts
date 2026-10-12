/** INPUT: 代币/精确价格、ANCHOR_WALLET/RPC_URL。 OUTPUT: mock 改价。 POSITION: EP8 管理员工具。 SYNC: folder.md。 */
import 'dotenv/config';
import { tokens, type Token } from '../scenario/lib/actors';
import { mocksProgram } from '../scenario/lib/mock-feed';
import { priceInstruction } from '../src/keeper/price';
import { cliRpc, readKeypair, sendInstructions } from './admin-runtime';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: set-price <tUSDC|tSOL> <价格>'); return; }
  if (args.length !== 2 || !tokens.includes(args[0] as Token)) throw Error('invalid arguments');
  // 价格是 i128/18 位，不能复用代币 u64 的上限；语法/精度共享，分段后再拼精确分子。
  const [whole, fraction = ''] = args[1].split('.');
  if (!/^\d+(?:\.\d+)?$/.test(args[1]) || fraction.length > 18) throw Error('invalid price');
  const price = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (price <= 0n || price >= 1n << 127n) throw Error('invalid i128 price');
  const admin = readKeypair(process.env.ANCHOR_WALLET), rpc = cliRpc();
  const value = await priceInstruction(rpc, mocksProgram(), args[0] as Token, price);
  console.log(await sendInstructions(rpc, admin, [value.instruction], [value.signer]));
}
void main().catch(() => { console.error('set price failed; check arguments and configuration'); process.exitCode = 1; });
