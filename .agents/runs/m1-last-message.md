已实现 [scenario 模块](/Users/lixin/code/github/rebetxin/solana-lending-indexer/scenario/README.md)，并将 M1 更新为 `doing`。

- **做了什么**：固定步骤、确定性账户、默认仅打印计划、Switchboard v1 创建/crank/改价、借贷清算指令、逐笔交易记录、Anchor EventParser、expected 累加与快照代码。feed 按指定 `PullFeed.generate` 随机创建，公钥清单用于复用。
- **检查结果**：`pnpm typecheck` 通过；`pnpm test` **14 项通过，0 失败、0 跳过**。
- **未运行或验证**：`--execute`、真实 Crossbar/feed/crank/改价、任何链上交易、链上对账及重跑验收；未生成真实 fixtures。
- **仍不确定**：同 feed 改价、价格有效期窗口、实际费用和链上兼容性需实测。`expected` 是事件净流量，受利息缺失和清算 f64 精度限制，不能视为精确结束余额。

未安装依赖、未发送链上交易、未提交 git。