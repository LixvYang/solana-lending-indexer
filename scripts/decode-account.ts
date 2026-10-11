/**
 * INPUT: CLI 账户地址、m1-accounts.json。
 * OUTPUT: 解码 JSON（bigint 为字符串）；错误退出 1。
 * POSITION: EP5 离线账户演示，不调用 RPC 或钱包。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import fixture from '../fixtures/m1-accounts.json';
import { decodeAccount } from '../src/decoder/account';
import { marginfiIdl } from '../src/decoder/idl';
const [address, ...extra] = process.argv.slice(2);
if (!address || extra.length) {
  console.error('用法: pnpm exec node --import tsx scripts/decode-account.ts <账户地址>'); process.exit(1);
}
const accounts = fixture.accounts as Record<string, { data: string }>;
if (!accounts[address]) { console.error(`账户不在 fixture: ${address}`); process.exit(1); }
const result = decodeAccount(Buffer.from(accounts[address].data, 'base64'), marginfiIdl);
console.log(JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
if ('decodeError' in result) process.exitCode = 1;
