/**
 * INPUT: CLI 交易签名、本地 m1-transactions.json。
 * OUTPUT: 解码 JSON（bigint 为十进制字符串），错误时退出码 1。
 * POSITION: EP4 离线演示入口；不导入 RPC、钱包或 scenario 执行代码。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import fixture from '../fixtures/m1-transactions.json';
import { marginfiIdl } from '../src/decoder/idl';
import { decodeTransaction, type RpcTransaction } from '../src/decoder/transaction';

const [signature, ...extra] = process.argv.slice(2);
const transactions = fixture.transactions as Record<string, RpcTransaction>;
if (!signature || extra.length > 0) {
  console.error('用法: pnpm exec tsx scripts/decode-tx.ts <签名>');
  process.exitCode = 1;
} else if (!Object.hasOwn(transactions, signature)) {
  console.error(`本地 fixture 中没有签名: ${signature}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(decodeTransaction(transactions[signature], marginfiIdl),
    (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2));
}
