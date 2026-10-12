/** INPUT: 显式密钥路径、RPC_URL。 OUTPUT: CLI 专用读钥/签名发送。 POSITION: setup/keeper 管理员工具，不被 API 导入。 SYNC: folder.md。 */
import { readFileSync } from 'node:fs';
import { Connection, Keypair, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { rpcConnection } from '../src/api/wallet-rpc';
import { submitSigned } from '../src/api/send';
import { encodeBase58 } from '../src/core/base58';
export function readKeypair(path: string | undefined): Keypair {
  if (!path) throw Error('keypair path required');
  const bytes: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw Error('invalid keypair file');
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
export function cliRpc() {
  if (!process.env.RPC_URL) throw Error('RPC configuration required');
  return rpcConnection(process.env.RPC_URL);
}
export async function sendInstructions(rpc: Connection, payer: Keypair, instructions: TransactionInstruction[], signers: Keypair[] = []) {
  const block = await rpc.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
  tx.sign([payer, ...signers]);
  const result = await submitSigned(tx.serialize(), encodeBase58(tx.signatures[0]), rpc);
  if (result.status !== 'confirmed') throw Error('transaction not confirmed');
  return result.signature;
}
