/** INPUT: PGlite、m1 fixtures 与真实 devnet 的 pSOL 银行/验证账户/Pyth 价格。 OUTPUT: 价格账户换算、Pyth 快照、池子视图与带置信区间的健康度断言。 POSITION: EP7 离线集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/pyth-accounts.json';
import { seedApi } from './test-utils';
import { snapshotAccounts, snapshotOracles } from '../store/accounts';
import { involvedOracles } from '../store/involved';
import { loadLabels } from '../store/labels';
import { decodePriceUpdate } from '../decoder/pyth';
import { getAccounts, getPool } from './queries';

const accounts = fixture.accounts as Record<string, { owner: string; lamports: number; data: string }>;
const by = Object.fromEntries(Object.entries(fixture.names).map(([address, name]) => [name, address]));
const rpc = { getMultipleAccounts: async (addresses: string[]) => ({ context: { slot: fixture.slot },
  value: addresses.map(a => ({ ...accounts[a], data: [accounts[a].data, 'base64'] as [string, 'base64'] })) }) };
const pyth = decodePriceUpdate(Buffer.from(accounts[by.pyth_SOL_USD].data, 'base64'));

test('Pyth 银行:索引器换算出价格账户并快照,池子显示真实价格,健康度按程序的置信区间方向计算', async () => {
  const db = await seedApi();
  try {
    await loadLabels(db, { mints: { pSOL: 'bjwmjXvFypKzUwfFEp4ZraarSWsF79e72HbLftQ3z33' }, banks: { pSOL: by.bank_pSOL },
      marginfiAccounts: { A: by.account_A, B: by.account_B }, actors: {} });
    await snapshotAccounts(db, rpc, [by.bank_pSOL, by.bank_tUSDC, by.account_A, by.account_B]);
    // oracle_keys[0] 是 feed id;索引器要快照的是换算出来的价格账户。
    assert.ok((await involvedOracles(db)).includes(by.pyth_SOL_USD));
    await snapshotOracles(db, rpc, [by.pyth_SOL_USD]); // 默认 owner 白名单包含 Pyth Receiver

    const pool = await getPool(db), pSOL = pool.banks.find(b => b.label === 'pSOL')!, tUSDC = pool.banks.find(b => b.label === 'tUSDC')!;
    assert.equal(pSOL.oracle_source, 'pyth');
    assert.equal(pSOL.oracle_feed, by.pyth_SOL_USD);
    assert.equal(pSOL.price, pyth.price.number);
    assert.equal(pSOL.price_updated_at, new Date(Number(pyth.publish_time) * 1000).toISOString());
    assert.equal(tUSDC.oracle_source, 'mock');

    const views = await getAccounts(db), A = views.find(a => a.label === 'A')!, B = views.find(a => a.label === 'B')!;
    const qty = (v: typeof A, label: string, side: 'deposit' | 'borrow') => Number(v.balances.find(b => b.label === label)![side]) / 10 ** (label === 'tUSDC' ? 6 : 9);
    const half = (price: number, conf: number) => Math.min(conf * 2.12, price * 0.05);
    // 这里用的是向下取整后的显示余额,API 用的是精确 shares,差在 1 个最小单位(1e-6 tUSDC)量级。
    const close = (actual: number | null, expected: number) => assert.ok(Math.abs(actual! - expected) < 1e-5, `${actual} vs ${expected}`);
    // A:存 pSOL(资产 → 下沿)借 tUSDC(mock,区间为 0)。维持用实时价,开仓用 EMA。
    const aMaint = qty(A, 'pSOL', 'deposit') * (pyth.price.number - half(pyth.price.number, pyth.conf.number)) * 0.9 - qty(A, 'tUSDC', 'borrow') * 1.05;
    const aInit = qty(A, 'pSOL', 'deposit') * (pyth.ema_price.number - half(pyth.ema_price.number, pyth.ema_conf.number)) * 0.8 - qty(A, 'tUSDC', 'borrow') * 1.1;
    close(A.health.maint, aMaint);
    close(A.health.init, aInit);
    // B:存 tUSDC 借 pSOL(负债 → 上沿)。
    const bMaint = qty(B, 'tUSDC', 'deposit') * 1 - qty(B, 'pSOL', 'borrow') * (pyth.price.number + half(pyth.price.number, pyth.conf.number)) * 1.05;
    close(B.health.maint, bMaint);
    // 方向对:区间让两人的健康度都比"只看中间价"更保守。
    assert.ok(A.health.maint! < qty(A, 'pSOL', 'deposit') * pyth.price.number * 0.9 - qty(A, 'tUSDC', 'borrow') * 1.05);
    assert.ok(B.health.maint! < qty(B, 'tUSDC', 'deposit') - qty(B, 'pSOL', 'borrow') * pyth.price.number * 1.05);
    assert.equal(A.status, 'healthy'); assert.equal(B.status, 'healthy');
  } finally { await db.close(); }
});
