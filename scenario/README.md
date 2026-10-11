# scenario

固定参与者、mint、group、bank 与借贷账户，固定步骤顺序。账户种子公开，仅用于 devnet 教学测试币，派生密钥不落盘。M1 当前只有离线验证，devnet 验收待验证。

在仓库根目录运行，使用已安装且锁定的依赖：

```bash
pnpm scenario                         # 仅打印计划，不需要钱包、RPC、IDL，不写输出
pnpm typecheck
pnpm test                             # 纯离线，IDL 检查读取 program/out/marginfi.idl.json
```

作者实测时配置 `.env`（变量见根目录 `.env.example`），确认 `program/out/program-ids.json` 的 `mode` 为 `devnet`、marginfi 已部署，且 IDL 对应 mrgn-0.1.0。之后才使用：

```bash
pnpm scenario --execute --run-id take-1
```

默认 group 固定。重复执行必须换 `--run-id`，派生新的 group、bank 和借贷账户；执行前发现这些账户已存在会报错，不在原 group 重复存借。参与者与 mint 复用，每轮铸造固定数量的测试币。admin 支付所有交易费用，并将三人的 SOL 补足到各 0.02 SOL。计划估算至少 0.30 SOL，另加现有 FeeState 的两个 bank 创建费；实际总花费待验证。

Switchboard 按任务指定使用 `PullFeed.generate`，因此 feed 地址是随机生成的例外；只把公钥保存到 `scenario/out/feeds.json`，创建密钥不落盘。后续运行复用这两个 feed，先将 tSOL 恢复到 $100；这些 feed 的价格修改也会影响旧 group。缺失或损坏的 manifest 不代表链上 feed 消失，作者应从 run 文件找回公钥后再处理，避免重复创建。

`run.ts` 处理执行开关，`plan.ts` 打印计划，`execute.ts` 串行调用 `steps/01-*.ts` 至 `12-*.ts`。`lib/actors.ts` 管派生，`marginfi.ts` 按 IDL 构造指令，`switchboard.ts` 管 v1 Crossbar / 创建 / crank / 改价，`rpc.ts` 发交易，`record.ts` 用 Anchor EventParser 解日志。

每笔交易的签名在调用发送 RPC 前写入 run 文件，以便发送超时后仍可核对（步骤仍为 `signed` 时，是否落链未知）。成功记录包含交易签名、slot、状态、交易元数据、Anchor 事件及 finalized 账户快照；失败记录保留已有结果，状态为 `failed`。`scenario/out/` 全部忽略：

- `run-<时间戳>.json`：地址、逐笔交易、事件和最后账户快照。
- `expected-<时间戳>.json`：按账户 / bank 累加事件中的原生数量，整数用十进制字符串；失败时标记 `incomplete`。
- `feeds.json`：admin 管理的两个 feed 公钥。

银行利率沿用上游配置，开仓费设为 0；tSOL 资产初始 / 维持权重为 0.8 / 0.9，tUSDC 负债权重为 1.1 / 1.05。先 crank，再紧接着单独发借款、清算、取款交易；Bank `oracleMaxAge` 显式设为 240 秒。10 tSOL 的清算只改善健康度，最后 Bob 用 `repay_all` 清债，避免一次清算超过上游允许的维持线。

事件净流量与余额快照并不等价：计息事件没有逐账户利息，清算事件用 f64 且没有 Carol 的存款减少量。`expected.ts` 按源码中的清算 / 保险折扣推算 Carol 支出，并在输出附带精度与利息限制。run 的快照另保存 `shares × shareValue / 2^96` 的有理数原生余额供后续对账；没有宣称精确对账已通过。

未运行：`--execute`、Crossbar 真实存储、创建 feed、crank、改价、任何借贷或清算交易、链上快照对账及重复运行验收；没有生成真实 fixtures。尤其**改价路径尚未在链上验证**，以及两笔 crank / 业务交易之间的有效期、SDK 与链上布局兼容性、实际费用仍需作者实测。
