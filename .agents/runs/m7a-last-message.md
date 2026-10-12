M7a 已实现：交易构建/转发、钱包信息、POST/CORS/请求体限制、独立水龙头、setup、keeper 和改价工具。文档与进度已同步，`src/api/types.ts` 未修改，未新增依赖。

- **检查**：`pnpm typecheck` 通过；最终 `pnpm test` **129 项全部通过**；文档片段检查、`git diff --check` 通过。
- **突变验证**：remaining 逆序、首次存款漏 init、删除 PriceStale 判断、删除 marginfi 转发守卫。四次测试均退出 1，随后还原；漏 init 在部分签名阶段被捕获。
- **未运行或验证**：没有联网、发送链上交易或提交 git；未运行工具正常联网路径、生成持久密钥、启动 socket/Postgres 或前端联调。真实 devnet 模拟、水龙头转账、keeper 写入及长期运行均待验证。
- **不确定性**：首轮全套测试出现已有 V8/PGlite 原生崩溃，复跑通过但根因未修复；账户发现有 indexer 延迟，快照可能过旧；keeper 与改价有覆盖竞态；任务要求的 `oracle_max_age=0 → 240` 与上游 SwitchboardPull 行为不同。
- **契约异议**：HTTP 错误体缺少共享类型；SendRequest 缺过期高度；`all=true` 时 amount 仍必填但忽略；密钥注释未区分独立水龙头与管理员工具的进程边界。

完整记录见 [D-015](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/decisions.md) 和 [M7a 进度](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/progress.md)。