/** INPUT: 不可信 RPC 错误/日志、固定 IDL。 OUTPUT: 固定公开错误、脱敏日志。 POSITION: M7 错误翻译边界。 SYNC: folder.md。 */
import idl from '../decoder/idl/marginfi.idl.json';
import type { ProgramErrorView } from './types';
const messages: Record<string, string> = {
  RiskEngineInitRejected: '抵押健康度不足或价格过期，请减少借款/取款或补充抵押。',
  StaleOracle: '价格已过期，请检查价格维护进程。',
  BankAssetCapacityExceeded: '池子存款额度已满。', BankLiabilityCapacityExceeded: '池子借款额度已满。',
  IllegalUtilizationRatio: '池子流动性不足，请减少数量。', LendingAccountBalanceNotFound: '没有这个代币的头寸。',
  NoAssetFound: '没有可取出的存款。', NoLiabilityFound: '没有待偿还的借款。', BankPaused: '池子已暂停。',
};
export function programError(error: unknown): ProgramErrorView {
  const ix = error && typeof error === 'object' && 'InstructionError' in error ? error.InstructionError : null;
  const detail = Array.isArray(ix) ? ix[1] : null;
  const code = detail && typeof detail === 'object' && typeof detail.Custom === 'number' ? detail.Custom : null;
  const entry = idl.errors.find(e => e.code === code);
  return { code, name: entry?.name ?? 'Unknown', message: entry ? messages[entry.name] ?? entry.msg : '交易未能执行，请重新构建并重试。' };
}
// 不回显任意异常/日志内容：它可能含服务端 RPC 配置、私钥或恶意程序输出。
// 只保留 Solana runtime 的公开执行框架日志，Program log/data 统一省略。
export function publicLogs(logs: string[] | null | undefined): string[] {
  return (logs ?? []).map(line => /^Program [1-9A-HJ-NP-Za-km-z]{32,44} (invoke \[\d+\]|success|consumed \d+ of \d+ compute units)$/.test(line) ? line : '[program output omitted]');
}
