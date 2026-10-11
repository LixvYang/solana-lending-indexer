已完成 M2，并更新 [进度文档](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/progress.md) 和 EP4 说明。

- **实现**：手写 base58、Reader、IDL 驱动的 Borsh 解码、账户角色、顶层/inner 指令展开、错误隔离及离线 CLI；未新增依赖。
- **验证**：`pnpm typecheck` 通过；`pnpm test` **35 项通过，0 失败、0 跳过**。全部 36 个 discriminator 一致；32 笔 fixture 中的 18 条 marginfi 指令与 Anchor 一致。
- **未运行**：联网、部署、链上交易、数据库和余额对账；未提交 git。
- **仍待确认**：非空 v0 地址表和 marginfi CPI 仅经合成测试；其余 25 类指令没有真实参数样本验证。
- **运行限制**：直接 `pnpm exec tsx ...` 被沙箱的 IPC 限制阻止；替代命令 `pnpm exec node --import tsx scripts/decode-tx.ts <签名>` 已成功运行。测试依赖使用 bigint 的纯 JavaScript 回退，原生绑定未验证。