# EP6 存储设计

状态：M4 已实现，离线验收；真实 Postgres / RPC 运行待验证。

## 本章要回答的一个问题

怎样保存链上事实，让重复采集、崩溃重跑、解码器升级都得到一致的表？

## 三个边界

1. **原始和派生**：ingest 只写 raw_tx。原始 getTransaction JSON（含 meta、失败原因）先持久化，随后 decoder 纯函数生成 instructions / events。账户 RPC 走独立 snapshotAccounts，account_states.data 保留 `raw_data` base64 与解码字段，账户布局变动也能离线重建。
2. **幂等和原子性**：signature 唯一；指令键是 `(signature, ix_index, inner_index)`，事件键是 `(signature, log_index)`。每 slot 的原始交易与 blocks 游标同一个事务，异常同时回滚；decodePending 的派生行与 decoded_version 同一个事务。旧版本先删再写，避免新版减少输出时遗留旧行。
3. **finalized 和当前状态**：所有 RPC 请求都明确 finalized。只接受 legacy/v0（maxSupportedTransactionVersion=0），不处理链重组。账户 `context.slot` 是采样时间，不能拿交易 slot 充当历史账户状态；跨 100 账户的批次各用自己的 context.slot，不保证跨批一致。

数据顺序：`finalized RPC → raw_tx → instructions/events`；`finalized getMultipleAccounts → owner 检查 → account_states`。

## 代码走读

SQL 注释解释主键与前端查询索引。顶层指令 inner_index 用 -1：普通 UNIQUE 的 NULL 不相等，PRIMARY KEY 本身也禁止 NULL；不能以 NULL 表示唯一键中的顶层位置。

{{ snippet src/store/migrations/002_decoded.sql#ep6-schema }}

同一签名重复插入返回 false，不覆盖已经保存的事实。失败交易也保存，指令仍解码；M3 的 decodeEvents 屏蔽失败交易的事件。

{{ snippet src/store/raw.ts#ep6-idempotent-insert }}

空块与明确的 skipped slot 也推进游标。-32007 当作 skipped；-32009（节点历史缺失）和 null block 报错，保留游标供重试，不能把缺失当作空块。

{{ snippet src/ingest/tail.ts#ep6-cursor-tx }}

rebuildDecoded 在事务内清空指令/事件、重置版本、重建原始账户快照的解码字段，再完整重放 raw_tx；不会删除作为事实的账户原始字节。DECODER_VERSION 当前为 1，解码逻辑改变时递增。

{{ snippet src/store/decode.ts#ep6-rebuild }}

owner 在 decodeAccount 前检查，错误 owner 拒绝当前批次并报错；此前已提交的其他批次仍保留。直接 snapshotAccounts 默认拒绝缺失账户；CLI 共用 syncStored 只选择成功交易的角色地址，对已关闭的历史账户报告缺失并跳过。

{{ snippet src/store/accounts.ts#ep6-owner-check }}

## 运行与验证

以下真实连接命令是使用说明，本次没有运行数据库连接或 RPC 采集：

```bash
docker compose up -d
# DATABASE_URL 默认 postgres://indexer:indexer@localhost:5433/indexer
pnpm migrate
# 通过环境设置 RPC_URL；含 api-key 的 URL 不要写入仓库
pnpm ingest --backfill
pnpm ingest --tail --once --from 509953029
pnpm ingest --tail
pnpm reindex
```

backfill 分页到空页，遇到已有签名只跳过下载，继续翻页；err 非空照样入库。null getTransaction 报错，重跑时仍会尝试。

tail 首次没有游标：--from 包含起点，未设置时从当前 finalized slot 开始；已有 blocks 游标时总是从 cursor+1 恢复，--from 不覆盖它。--once 固定本轮查询到的 finalized 高度，处理完退出。CLI 每轮采集后自动 decodePending，再从指令账户角色提取 bank / marginfi account / group 做当前快照；reindex 完全不调用 RPC。

```bash
pnpm typecheck
pnpm test
```

数据库测试只用进程内 PGlite，不开端口。验收包括 32 原始交易两次写入、18 指令/25 事件独立对照、重复解码、清库重跑与重建逐行相等、版本升级删除旧行但不改当前行、slot/解码事务崩溃恢复、七账户读回后的 reconcile.issues=[]、owner 拒绝、合成 CPI/v0/skipped、RPC 重试与 key 脱敏、CLI 参数和帮助入口。

## 常见坑与边界

- PGlite 的 int8 在本机可返回 number 或 bigint，pg 默认返回字符串；Db 根据 SQL OID=20 统一为字符串并保留 null。pg 仅用 Pool 最小替身验证，未实测真实连接。
- 解码整数在 JSONB 保存为十进制字符串；fromJson 按 IDL 类型恢复 bigint，不会把 pubkey、普通 string、f64、原始 I80F48 字节误转。M3 对账需要先恢复事件整数。
- 账户快照保存当前状态，不提供逐笔历史；采集完成后 RPC 返回的状态可能比所采交易更新。账户关闭会报告并跳过，owner 不匹配会报错退出，不能用旧快照冒充最新。没有实现关闭墓碑，查询端需注意旧快照不是当前存在性证明。
- 重建不修 scenario/expected；事件净流量仍带 D-011 的利息/f64/ceil 差，对账的精确验收对象是账户状态/shares。
- 公共节点历史保留有限；回填只覆盖节点可见的分页历史。重试有限且指数退避，耗尽后退出，保留已提交事实。
- 教学版本面向单采集进程；未验证多个迁移/重建 worker 并发、生产级吞吐、RPC 限流压力或长期运行。

本次实际验证和突变记录见 docs/progress.md 的 M4；设计取舍与未验证项见 D-012。下一章使用派生表实现只读 API 与池子展示。
