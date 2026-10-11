export const labels = [
  '打印计划', '创建 tUSDC(6 位)、tSOL(9 位)，铸币并给三人转 SOL',
  '创建 Switchboard feed：tUSDC=$1、tSOL=$100，crank', '创建 marginfi group',
  '添加两个 bank 并绑定 SwitchboardPull', '初始化三人的 marginfi account',
  'alice deposit 10,000 tUSDC', 'bob deposit 100 tSOL', 'bob borrow 5,000 tUSDC（先 crank）',
  '两个 bank accrue interest', 'tSOL 改价到 $50，crank',
  'carol deposit 6,000 tUSDC，然后 liquidate bob 10 tSOL（先 crank）',
  'alice withdraw 1,000 tUSDC；bob repay_all（若仍有负债）',
] as const;

export function parseArgs(args: string[]) {
  let execute = false;
  let runId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') execute = true;
    else if (args[i] === '--run-id') {
      runId = args[++i] ?? '';
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) throw new Error('run-id 必须是 1–64 位字母、数字、_ 或 -');
    } else throw new Error(`未知参数：${args[i]}`);
  }
  return { execute, runId };
}

export function printPlan(runId = '', print: (line: string) => void = console.log) {
  print('M1 devnet 剧本：默认仅打印计划；--execute 才会发送交易。');
  print(`run-id：${runId || '(固定默认 group)'}；重拍请指定新的 --run-id。`);
  labels.forEach((label, i) => print(`${i}. ${label}`));
  print('权重：tSOL 初始 0.8 / 维持 0.9，tUSDC 负债初始 1.1 / 维持 1.05。');
  print('$100 时初始健康度约 +$2,500；$50 时维持健康度约 -$750（不含利息）。');
  print('预算约 0.30 SOL：转给参与者 0.06、账户租金约 0.15、crank 约 0.02、费用与余量约 0.07。');
  print('这是离线估算；实际租金、FeeState 收费及 oracle 费用需运行时核对。');
  print('公开种子仅供教学测试币使用。计划模式不读取钱包，不访问 RPC / Crossbar。');
}
