/**
 * INPUT: m1-transactions.json 与 m1-run.json。
 * OUTPUT: transactionFor、transactions、signatures 和 run。
 * POSITION: 仅测试使用的 fixture 加载与查找。
 * SYNC: 修改时同步本头部与 folder.md。
 */
import fixture from '../../fixtures/m1-transactions.json';
import run from '../../fixtures/m1-run.json';
import type { RpcTransaction } from './transaction';

export { run };
export const transactions = fixture.transactions as Record<string, RpcTransaction>;
export const signatures = fixture.signatures;
export function transactionFor(label: string): RpcTransaction {
  const step = run.steps.find(step => step.label === label);
  if (!step) throw new Error(`missing fixture step: ${label}`);
  return transactions[step.signatures[0]];
}
