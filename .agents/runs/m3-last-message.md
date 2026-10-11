已完成 M3 离线实现，未提交 git、未联网、未发送链上交易。

- **实现**：事件调用栈与归属、失败/未知/截断处理、f32/f64、IDL 动态 zero_copy 布局、精确 I80F48、账户解码、对账和两个离线 CLI；同步了 EP5、进度与 [D-011](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/decisions.md)。未修改 `scenario/expected.ts`。
- **验证**：`pnpm typecheck` 通过；`pnpm test` **56 项通过，0 失败、0 跳过**。七份账户与 Anchor 一致，shares 不变量及数量分子精确通过。任务写 24 条事件，fixture 实际是 **25 条**，已全部对照。
- **突变验证**：字段偏移 +8、I80F48 经 `Number`、移除失败交易屏蔽、清算比例 39/38 改为 1；四种均使测试失败，已还原。
- **未验证与不确定性**：未重跑剧本、部署、启动数据库或查询最新链上状态；CPI、失败、截断仅合成测试。未精确拆分逐笔利息、还款取整和清算定点截断的贡献；Carol 清算支出仍按 39/38 推算。其他事件、账户版本及费用场景没有真实样本。Anchor 使用现有纯 JS 回退，原生 bigint 绑定未验证。