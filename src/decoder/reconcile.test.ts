/**
 * INPUT: 独立 Anchor 结束快照、事件与原始账户。
 * OUTPUT: shares 原始位数不变量、精确有理数与差值分类断言。
 * POSITION: EP5 对账验收，不把净流量当余额。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, signatures, transactions } from './test-utils';
import { fixtureAccounts } from './m3-test-utils';
import { decodeEvents } from './event';
import { marginfiIdl } from './idl';
import { reconcile } from './reconcile';

const events = () => signatures.flatMap(s => decodeEvents(transactions[s], marginfiIdl).events);
test('两个 bank 的 shares 逐位相等，每个数量与 Anchor snapshot 分子完全相等', () => {
  const result = reconcile(events(), fixtureAccounts());
  assert.deepEqual(result.issues, []); assert.equal(result.banks.length, 2); assert.equal(result.balances.length, 6);
  for (const bank of result.banks) {
    assert.equal(bank.assetShares, bank.totalAssetShares); assert.equal(bank.liabilityShares, bank.totalLiabilityShares);
  }
  for (const [account, snapshot] of Object.entries(run.snapshots.accounts)) for (const q of snapshot.quantities) {
    const row = result.balances.find(b => b.account === account && b.bank === q.bank)!;
    assert.equal(row.deposit.state.numerator.toString(), q.depositNumerator);
    assert.equal(row.borrow.state.numerator.toString(), q.borrowNumerator);
    assert.equal(row.deposit.state.denominator.toString(), q.denominator);
  }
});
test('每账户每 bank 的差值方向和量级，清算 f64 残留不被归零', () => {
  const result = reconcile(events(), fixtureAccounts()), a = run.addresses;
  const row = (actor: keyof typeof a.marginfiAccounts, bank: keyof typeof a.banks) =>
    result.balances.find(b => b.account === a.marginfiAccounts[actor] && b.bank === a.banks[bank])!;
  const between = (v: { numerator: bigint; denominator: bigint }, low: bigint, high: bigint) => {
    assert.ok(v.numerator > low * v.denominator && v.numerator < high * v.denominator);
  };
  between(row('alice', 'tUSDC').deposit.difference, 1546n, 1547n);
  between(row('carol', 'tUSDC').deposit.difference, 348n, 349n);
  between(row('bob', 'tUSDC').borrow.difference, 2176n, 2177n);
  assert.deepEqual(row('alice', 'tUSDC').deposit.difference, {
    numerator: 122533407042021320331036085304105n, denominator: 79228162514264337593543950336n });
  assert.deepEqual(row('carol', 'tUSDC').deposit.difference, {
    numerator: 262333926684415432443825514641763n, denominator: 752667543885511207138667528192n });
  assert.deepEqual(row('bob', 'tUSDC').borrow.difference, { numerator: 2281701377n, denominator: 1048576n });
  assert.ok(row('alice', 'tUSDC').deposit.categories.includes('interest'));
  assert.ok(row('carol', 'tUSDC').deposit.categories.includes('f64_precision'));
  assert.ok(row('bob', 'tUSDC').borrow.categories.includes('other'));
  assert.equal(row('bob', 'tUSDC').borrow.state.numerator, 0n);
  // 5000001696.077838 - 4525001696.077837 实际 binary64 差为 475000000 + 2^-20。
  const paid = row('bob', 'tUSDC').borrow.liquidation;
  assert.equal(paid.numerator * (1n << 20n), -(475000000n * (1n << 20n) + 1n) * paid.denominator);
  for (const b of result.balances) {
    if (b.bank === a.banks.tSOL) assert.equal(b.deposit.difference.numerator, 0n);
    if (b.account !== a.marginfiAccounts.bob || b.bank !== a.banks.tUSDC) assert.equal(b.borrow.difference.numerator, 0n);
  }
});
test('shares 损坏、缺 bank、坏事件与反方向大差值必须报告', () => {
  assert.ok(reconcile([], {}).issues.length);
  const accounts = fixtureAccounts(), bank = run.addresses.banks.tUSDC;
  const damaged = structuredClone(accounts);
  const data = damaged[bank]; assert.ok('data' in data);
  (data.data.total_asset_shares as { value: number[] }).value[0] ^= 1;
  assert.ok(reconcile(events(), damaged).issues.some(i => i.includes('shares')));
  delete accounts[bank]; assert.ok(reconcile(events(), accounts).issues.some(i => i.includes('bank')));
  const badEvents = events();
  const e = badEvents.find(e => e.name === 'LendingAccountDepositEvent')!;
  assert.equal(typeof e.data, 'object'); (e.data as Record<string, unknown>).amount = 10000000000000n;
  assert.ok(reconcile(badEvents, fixtureAccounts()).issues.some(i => i.includes('unexplained')));
  assert.ok(reconcile([{ signature: 'bad', name: 'unknown', data: 'AA==', ixIndex: 0, logIndex: 0 }], fixtureAccounts()).issues.length);
});

test('正差也不能无限解释成利息；超过累计入账 × 最终 share_value 增幅必须报告', () => {
  const badEvents = events();
  const repay = badEvents.find(e => e.name === 'LendingAccountRepayEvent')!;
  (repay.data as Record<string, unknown>).amount = 4526002176n;
  assert.ok(reconcile(badEvents, fixtureAccounts()).issues.some(i => i.includes('unexplained')));
});

// 审查补充：独立于 reconcile 的"分类"推断，用守恒检验利息解释。
// 借款人多付的利息 = 存款人赚到的利息 + 协议费 + 保险费。
// 协议费与保险费来自程序自己发出的 AccrueInterest 事件(f64)，存款人利息来自状态，
// 借款人多付额来自状态；三者互不依赖，对得上才说明"差值就是利息"。
test('tUSDC 利息守恒：存款人所得 + 协议费 + 保险费 ≈ 借款人多付，差距小于 1 个原生单位', () => {
  const all = events();
  const result = reconcile(all, fixtureAccounts());
  const bank = run.addresses.banks.tUSDC, a = run.addresses.marginfiAccounts;
  const toNumber = (d: { numerator: bigint; denominator: bigint }) => Number(d.numerator * 1_000_000n / d.denominator) / 1e6;
  const diff = (account: string, side: 'deposit' | 'borrow') => {
    const row = result.balances.find(b => b.account === account && b.bank === bank)!;
    return toNumber(row[side].difference);
  };
  const accrues = all.filter(e => e.name === 'LendingPoolBankAccrueInterestEvent'
    && typeof e.data !== 'string' && (e.data as { bank: string }).bank === bank)
    .map(e => e.data as unknown as { fees_collected: number; insurance_collected: number });
  assert.equal(accrues.length, 7);
  const charges = accrues.reduce((sum, e) => sum + e.fees_collected + e.insurance_collected, 0);
  const depositorsEarned = diff(a.alice, 'deposit') + diff(a.carol, 'deposit');
  const borrowerPaid = diff(a.bob, 'borrow');
  assert.ok(Math.abs(borrowerPaid - (depositorsEarned + charges)) < 1,
    `borrower ${borrowerPaid} vs depositors ${depositorsEarned} + charges ${charges}`);
  // 数量级自检：这些数都是约 2 千个原生单位(≈ 0.002 tUSDC)，不是 0。
  assert.ok(borrowerPaid > 2000 && borrowerPaid < 2300);
});
