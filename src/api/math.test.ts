/** INPUT: fixtures / 本地 bank 权重。 OUTPUT: 利率、精确数量、清算健康金标准。 POSITION: EP7 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import { fixtureAccounts } from '../decoder/m3-test-utils';
import type { Fixed } from '../decoder/account';
import { curveRate, rates, nativeAmount, shareQuantity, health } from './math';
import type { InterestCurve } from './types';
const curve: InterestCurve = { optimal_utilization: .5, plateau_rate: .6, max_rate: 3, fee_rate: .06, fee_fixed_apr: .04 };
test('piecewise curve and both summed fees; clamp finite utilization, reject NaN', () => {
  for (const [u, expected] of [[0,0],[.25,.3],[.5,.6],[.75,1.8],[1,3]]) assert.ok(Math.abs(curveRate(u, curve)-expected)<1e-12);
  const result = rates(.75, curve);
  assert.ok(Math.abs(result.lending_apr-1.35)<1e-12);
  assert.ok(Math.abs(result.borrowing_apr-1.948)<1e-12);
  assert.equal(curveRate(2, curve),3); assert.equal(curveRate(-1,curve),0);
  assert.throws(()=>curveRate(NaN,curve)); assert.throws(()=>rates(Infinity,curve));
});
test('native share multiplication retains values beyond safe integers and floors', () => {
  const fixed = (bits: bigint): Fixed => { const b=Buffer.alloc(16); b.writeBigUInt64LE(bits & ((1n<<64n)-1n)); b.writeBigInt64LE(bits>>64n,8); return {value:[...b],decimal:''}; };
  const shares=fixed(((1n<<60n)+1n)*(1n<<48n)), value=fixed((1n<<48n)+1n);
  const q=shareQuantity(shares,value);
  assert.equal(q.numerator, (((1n<<60n)+1n)*(1n<<48n))*((1n<<48n)+1n));
  assert.equal(nativeAmount(shares,value),q.numerator/q.denominator);
});
test('Bob liquidation pre/post maint health matches program f64 within 1e-6', () => {
  const decoded=fixtureAccounts(), banks=Object.fromEntries(Object.entries(run.addresses.banks).map(([token,address])=>{
    const d=decoded[address]; assert.ok('data' in d); const c=d.data.config as Record<string,Fixed>;
    return [address,{decimals: token==='tSOL'?9:6,weights:{asset_init:Number(c.asset_weight_init.decimal),asset_maint:Number(c.asset_weight_maint.decimal),liability_init:Number(c.liability_weight_init.decimal),liability_maint:Number(c.liability_weight_maint.decimal)}}];
  }));
  const event=run.events.find(e=>e.name==='LendingAccountLiquidateEvent')!.data as any;
  for (const [side,expected] of [['pre',event.liquidateePreHealth],['post',event.liquidateePostHealth]] as const) {
    const b=event[`${side}Balances`];
    const balances=[{bank:run.addresses.banks.tSOL,deposit:b.liquidateeAssetBalance,borrow:0},{bank:run.addresses.banks.tUSDC,deposit:0,borrow:b.liquidateeLiabilityBalance}];
    const prices={[run.addresses.banks.tSOL]:50,[run.addresses.banks.tUSDC]:1};
    assert.ok(Math.abs(health(balances,banks,prices,'maint')!-expected)<1e-6);
    assert.equal(health(balances,banks,{...prices,[run.addresses.banks.tSOL]:null},'maint'),null);
  }
});
