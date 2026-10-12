M5a 已实现，未修改 `src/api/types.ts`、未新增依赖、未提交 git。

- **完成内容**：PullFeed 精确解码与共用偏移、预言机 owner 白名单快照、labels 迁移与导入、精确数量/利率/健康度、稳定分页、X 光及六个只读 HTTP 路由。文档已同步。
- **最终检查**：`pnpm typecheck` 退出 0；`pnpm test` **102 项通过，0 失败、0 跳过**。清算前后健康度与程序报告差均小于 `1e-6`。
- **突变验证**：临时把维持权重换成开仓权重、漏固定 APR 费用、反转状态判断、spans 漏最后字段；分别导致 **1、1、1、2 项失败**，均已还原。
- **未验证**：真实 PostgreSQL 的新增迁移及 CLI 正常路径、HTTP socket、浏览器/前端联调、并发和吞吐。全程未联网、未发送链上交易。
- **不确定性**：一次重跑发生 Node/V8 WebAssembly 原生崩溃，单文件及完整复跑通过，但根因未定位。价格新鲜度、混合 slot 一致性和通用链上风险规则也未验收。
- **契约异议**：缺价格时没有未知状态，只能保守返回 `liquidatable`，同时健康度为 null，不能据此证明可清算；利用率限定 0..1 会隐藏超额借款；健康度“逐位一致”的注释应改为容差；契约缺少价格来源/过期状态及混合采样信息。

详细证据见 [进度记录](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/progress.md:70) 和 [D-013](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/decisions.md:222)。