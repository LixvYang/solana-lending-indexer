# 任务 M4:存储与取块(EP6)

交给 codex 实现。先读 `AGENTS.md`、`docs/00-goals.md`、`docs/decisions.md`(尤其 D-005、D-008–D-011)、`docs/chapters/ep06-storage.md`,并浏览已实现的 `src/core`、`src/decoder`(M2、M3,沿用其风格:手写、纯函数优先、小文件、snake_case)。

## 目标

把"链上原始数据 → 可查询的表"这条流水线搭起来,并满足三条硬性质:

1. **先存原始,再解码。** `raw_tx` 是唯一事实来源;指令/事件/账户状态表都能由它(加账户快照)重建。
2. **幂等。** 同一批数据重复入库、中途崩溃后重跑,结果与一次跑完完全相同。
3. **只信 finalized。** 不处理链重组;这是明确的局限,写进文档。

验收口径(来自 `docs/00-goals.md`):**清库重跑结果一致**。

## 依赖与测试方案(已装好,不要联网、不要改版本)

- `pg` 8.23.1:生产连接 Postgres(`docker compose up -d`,端口 5433)。
- `@electric-sql/pglite` 0.5.8:**进程内** Postgres,用于 `pnpm test`,因为你的沙箱连不上网络/本地端口。测试里一律用它。
- 两者通过一个很薄的接口 `Db`(`query(sql, params)` 与 `transaction(fn)`)适配。**已知差异**:PGlite 把 `BIGINT` 返回成 JS `bigint`,`pg` 默认返回字符串。适配层必须统一(统一成字符串),并有测试覆盖这个差异,不要让上层代码关心用的是哪个。
- 迁移用 SQL 文件 + 一个 50 行以内的手写 runner(`schema_migrations` 表记录已应用的文件,事务内应用,重复运行无副作用)。**不用 ORM**。`docker-compose.yml` 已不再挂载 initdb 目录,迁移只由 runner 负责。

## 输入

- `fixtures/m1-transactions.json`:32 笔 RPC 原始交易(`getTransaction`,`encoding: "json"`),其中 18 笔含 marginfi 指令。
- `fixtures/m1-accounts.json`:7 个账户的原始字节。
- `fixtures/m1-run.json`:`steps` / `events` / `addresses` / `snapshots`,作为独立对照。
- 已实现的解码器:`decodeTransaction`(M2)、`decodeEvents`、`decodeAccount`、`reconcile`(M3)。

## 要实现

| 文件 | 内容 |
|---|---|
| `src/store/db.ts` | `Db` 接口与两个实现(`pg` Pool、PGlite);bigint 统一 |
| `src/store/migrate.ts` + `src/store/migrations/002_decoded.sql` | runner;表结构见下 |
| `src/store/json.ts` | 把解码结果(含 `bigint`)序列化成 JSONB 友好的形式:bigint → 十进制字符串;**往返不丢精度**,有测试 |
| `src/store/raw.ts` | `insertRawTx(db, tx)`:`ON CONFLICT (signature) DO NOTHING`,返回是否新插入 |
| `src/store/decode.ts` | `decodePending(db, idl)`:对 `raw_tx` 中 `decoded_version` 为空或小于当前 `DECODER_VERSION` 的行,**一个事务内**写入 instructions、events 并更新 `decoded_version`;`rebuildDecoded(db, idl)`:清空解码表后重建 |
| `src/store/accounts.ts` | `snapshotAccounts(db, rpc, addresses)`:用 `getMultipleAccounts`(finalized)取账户,**先检查 owner == 程序地址**(M3 的遗留事项),再 `decodeAccount`,写入 `account_states`(主键 `(address, slot)`,`slot` 用响应里的 `context.slot`)。注释写清楚局限:RPC 只给**当前**状态,历史状态需要每笔交易后快照,这里不做 |
| `src/ingest/rpc.ts` | 手写 JSON-RPC 客户端(`fetch`),带重试与指数退避(公共/免费节点会偶发 `fetch failed` 和 429);方法:`getSlot`、`getBlocks`、`getBlock`、`getSignaturesForAddress`、`getTransaction`、`getMultipleAccounts`。URL 里的 `api-key` 在任何日志/错误里都要打码 |
| `src/ingest/block.ts` | `fetchProgramTxs(rpc, slot, programId)`:`getBlock`(`encoding: "json"`、`transactionDetails: "full"`、`rewards: false`、`maxSupportedTransactionVersion: 0`、`finalized`),保留**调用了该程序**的交易(顶层或 inner 指令的 program id 等于它;注意 v0 的 `loadedAddresses`),并**规范化成与 `getTransaction` 相同的形状**(补上 `slot`、`blockTime`、`version`)。被跳过的 slot(`getBlock` 返回"slot skipped"类错误)要正确处理,不是失败 |
| `src/ingest/signatures.ts` | 回填来源:`getSignaturesForAddress(programId)` 分页到头,**跳过 `raw_tx` 里已有的签名**再逐个 `getTransaction`;忽略 `err` 非空的交易还是入库?——**入库**(失败交易也是事实,`raw_tx.err` 已有该列),解码时跳过其事件 |
| `src/ingest/tail.ts` | 实时来源:游标 `ingest_cursor('blocks')`;每轮 `getSlot(finalized)`,处理 `(cursor, latest]`:每个 slot 的写入(`raw_tx` + 推进游标)在**同一个事务**里提交;`--once` 处理到当前 finalized 就退出 |
| `scripts/migrate.ts`、`scripts/ingest.ts`、`scripts/reindex.ts` | CLI:`migrate`;`ingest --backfill` / `ingest --tail [--once] [--from <slot>]`(之后自动 `decodePending` 并对涉及的 bank / marginfi 账户 / group 做 `snapshotAccounts`);`reindex` = `rebuildDecoded`。读取 `DATABASE_URL`(默认 `postgres://indexer:indexer@localhost:5433/indexer`)与 `RPC_URL`,程序地址取 IDL 的 `address` |

### 表(`002_decoded.sql`;`raw_tx`、`ingest_cursor` 已在 001)

```
ALTER TABLE raw_tx ADD COLUMN decoded_version INT;

instructions(signature, ix_index, inner_index INT NOT NULL DEFAULT -1, slot, block_time,
             stack_height, name, args JSONB, accounts JSONB, remaining JSONB, decode_error TEXT,
             PRIMARY KEY (signature, ix_index, inner_index),
             FOREIGN KEY (signature) REFERENCES raw_tx ON DELETE CASCADE)

events(signature, log_index, ix_index, slot, block_time, name, data JSONB, truncated BOOL,
       PRIMARY KEY (signature, log_index), FOREIGN KEY ... ON DELETE CASCADE)

account_states(address, slot, type, owner, lamports BIGINT, data JSONB,
               PRIMARY KEY (address, slot))
```

补索引:`instructions(name)`、`events(name)`、`events(slot)`,以及按 `data->'header'->>'marginfi_account'` 查事件所需的表达式索引——每个索引在注释里写明服务于哪个查询(EP7 前端会用)。主键设计的**理由**写进 SQL 注释(为什么 `inner_index` 用 -1 而不是 NULL:主键里的 NULL 不参与唯一性比较)。

`DECODER_VERSION` 放在 `src/decoder/version.ts`(初值 1)。

## 测试(`node:test`,放在对应文件旁,全部离线,数据库用 PGlite)

1. **Db 适配**:`BIGINT` 在两种实现下行为一致(用 PGlite 实测;`pg` 那侧用一个对 `Pool` 的最小替身验证类型转换函数即可)。
2. **迁移**:重复运行无副作用;表与索引存在;失败的迁移整体回滚。
3. **幂等**:把 `m1-transactions.json` 的 32 笔交易 `insertRawTx` 两遍 → 行数 32;`decodePending` 两遍 → 解码表行数不变且内容相同。
4. **崩溃恢复**:`tail` 在处理某个 slot 的写入中途抛错(用注入的假 `rpc` 与会抛错的假 `Db` 包装),重跑后无重复、无缺失、游标正确。
5. **清库重跑一致**:全量入库并解码 → 导出所有解码表(排序后)→ `rebuildDecoded` → 再导出,**逐行相等**。再模拟 `DECODER_VERSION` 升级,`decodePending` 只重做旧版本行。
6. **与独立基准对照**:入库后,instructions 里各指令名的计数,与 `fixtures/m1-run.json` 的步骤/事件独立核对一致;events 表 25 行,名称与 `m1-run.json.events` 一致;`account_states` 写入后,用 `reconcile`(M3)从**数据库读出的**账户状态再对一遍账,`issues` 为空。
7. **getBlock 规范化**:用合成的区块(其中混有无关交易、一笔只在 inner instruction 里调用 marginfi 的交易、一笔含非空 `loadedAddresses` 的 v0 交易、一个被跳过的 slot)断言过滤与形状;并断言规范化后的交易与同签名的 `getTransaction` 结果在 `transaction`、`meta` 上深度相等(用 fixture 里的交易构造区块)。
8. **owner 检查**:`snapshotAccounts` 遇到 owner 不是 marginfi 的账户,拒绝写入并报告。
9. **失败交易**:`err` 非空的交易入 `raw_tx`、解码出指令但不产出事件。
10. 打码:RPC 错误信息里不出现 `api-key` 的值。
11. **突变验证**:本地临时改坏至少三处并确认测试失败再还原——例如去掉 `ON CONFLICT`、把游标推进移到事务之外、`rebuildDecoded` 漏清一张表;在汇报里写明。

## 代码要求

- 教学片段用 `// #region ep6-xxx`(至少:`ep6-schema`、`ep6-idempotent-insert`、`ep6-cursor-tx`、`ep6-rebuild`、`ep6-owner-check`)。
- 单文件尽量不超过约 150 行;SQL 写在 `.sql` 文件里,注释讲"为什么这样设计"。
- 不新增依赖,不联网,不发送交易。`pnpm typecheck` 与 `pnpm test` 必须通过。
- 更新 `docs/progress.md` 的 M4、`docs/chapters/ep06-storage.md`,在 `docs/decisions.md` 追加 D-012(设计取舍与**没有验证**的部分:真实 Postgres、真实 Helius、`pg` 侧的类型行为)。
- 不要提交 git。
