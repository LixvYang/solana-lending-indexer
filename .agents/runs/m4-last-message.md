M4 已实现，并更新 EP6、D-012、进度和模块文档。

- **实现**：Db/迁移、精确 JSON 往返、原始交易幂等入库、版本解码与重建、owner 快照检查、finalized RPC、回填、事务游标和三个 CLI。
- **验收**：`pnpm typecheck` 通过；`pnpm test` **85 项通过，0 失败、0 跳过**。覆盖清库重跑、崩溃恢复、独立 fixture 对照及数据库读回对账。
- **突变**：去掉 ON CONFLICT、移除 slot 事务、漏清两处 events、去掉 owner 检查，均触发测试失败后还原。单删 rebuild 清理仍通过，因为逐签名清理等效；另验证版本 2／旧行 1 升级成功，已恢复版本 1。
- **未验证**：真实 Postgres/Helius、真实 CLI 采集与 reindex、长期运行、并发和吞吐；pg 仅用 Pool 替身验证。
- **不确定性**：真实驱动/RPC 集成仍待验证；当前账户快照不能证明逐笔历史状态，关闭账户未实现墓碑；M3 的利息/f64/取整分摊限制仍在。

全程未联网、未发送链上交易、未提交 git。详见 [验收记录](/Users/lixin/code/github/rebetxin/solana-lending-indexer/docs/progress.md)。