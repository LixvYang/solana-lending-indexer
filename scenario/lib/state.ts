import { PublicKey } from '@solana/web3.js';
import type { Person } from './actors';
import { people, tokens } from './actors';
import type { Context } from './context';

export function fixedBits(wrapped: { value: number[] }): bigint {
  const bytes = Buffer.from(wrapped.value);
  if (bytes.length !== 16) throw new Error('WrappedI80F48 必须为 16 字节');
  return bytes.readBigUInt64LE(0) + (bytes.readBigInt64LE(8) << 64n);
}

export async function fetchAccount(ctx: Context, name: string, address: PublicKey, finalized = false): Promise<any> {
  const account = await ctx.provider.connection.getAccountInfo(address, finalized ? 'finalized' : 'confirmed');
  if (!account || !account.owner.equals(ctx.program.programId)) throw new Error(`${name} 不存在或 owner 错误：${address}`);
  // 使用 Anchor 的账户 coder 校验 discriminator；后续手写账户解码器以这份输出为对照。
  return ctx.program.coder.accounts.decode(name, account.data);
}
export async function hasDebt(ctx: Context, person: Person) {
  const account = await fetchAccount(ctx, 'marginfiAccount', ctx.actors.marginfiAccounts[person].publicKey);
  return account.lendingAccount.balances.some((balance: any) => balance.active && fixedBits(balance.liabilityShares) > 0n);
}

export async function snapshots(ctx: Context) {
  const banks: Record<string, any> = {};
  for (const token of tokens) {
    const address = ctx.actors.banks[token].publicKey;
    banks[address.toBase58()] = await fetchAccount(ctx, 'bank', address, true);
  }
  const accounts: Record<string, any> = {};
  for (const person of people) {
    const address = ctx.actors.marginfiAccounts[person].publicKey;
    const account = await fetchAccount(ctx, 'marginfiAccount', address, true);
    accounts[address.toBase58()] = { decoded: account,
      quantities: account.lendingAccount.balances.filter((balance: any) => balance.active).map((balance: any) => {
        const bank = banks[balance.bankPk.toBase58()];
        if (!bank) throw new Error('快照里出现剧本以外的 bank');
        // shares 与 share value 都有 48 位小数；以有理数保存，避免 Number 舍入后假称精确对账。
        return { bank: balance.bankPk.toBase58(), denominator: (1n << 96n).toString(),
          depositNumerator: (fixedBits(balance.assetShares) * fixedBits(bank.assetShareValue)).toString(),
          borrowNumerator: (fixedBits(balance.liabilityShares) * fixedBits(bank.liabilityShareValue)).toString() };
      }) };
  }
  return { banks, accounts, note: 'share value 是最后一次计息时的值；不预测未来利息。' };
}
