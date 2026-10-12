# 任务 M5a:只读 API(EP7 后端)

交给 codex 实现。先读 `AGENTS.md`、`docs/00-goals.md`、`docs/decisions.md`(尤其 D-009、D-011、D-012)、`docs/chapters/ep07-frontend.md`,并浏览 `src/core`、`src/decoder`、`src/store`、`src/ingest`(沿用风格:手写、纯函数优先、小文件、snake_case)。

**契约已定**:`src/api/types.ts`。后端输出必须与它一致,**不要改这个文件**;如果你认为契约有缺陷,在汇报里写出来,由我来改。前端正在并行开发,依赖这份契约。

## 目标

把数据库里的数据变成前端能直接展示的借贷池视图,并为"X 光"面板提供同一笔交易的三种形态(链上原始字节 / 解码结果 / 数据库行)。API 只读,不连 RPC。

## 输入(全部离线;测试用 PGlite,不要联网,不要改依赖)

- 数据库表:`raw_tx`、`instructions`、`events`、`account_states`(见 `src/store/migrations`);读取辅助 `fromJson`(`src/store/json.ts`)。
- fixtures:`fixtures/m1-transactions.json`、`m1-accounts.json`、`m1-run.json`(含 `addresses`、`events`、`steps`)。
- **预言机账户**(价格来源):marginfi 的 `Bank.config.oracle_keys[0]` 指向价格账户。它们是 mocks 程序拥有、**Switchboard `PullFeedAccountData` 布局**的账户(D-009)。偏移已经在 `scenario/lib/mock-feed.ts` 里并用真实账户 `fixtures/switchboard-pullfeed-uncranked.bin` 校验过。
- 上游利率与费用公式:`program/.upstream/programs/marginfi/src/state/marginfi_group.rs` 的 `InterestRateCalc::calc_interest_rate`(约 285–400 行)——借款利率 = `base × (1 + fee_ir) + fee_fixed`;存款利率 = `base × utilization`;`base` 为分段线性曲线。费用的各项求和方式以源码为准。

## 要实现

| 文件 | 内容 |
|---|---|
| `src/decoder/switchboard.ts` | `decodePullFeed(bytes)`:返回 `{ price, std_dev, last_update_timestamp, slot, sample_size, queue, authority, feed_hash }`；价格 = `result.value`(i128,18 位小数)的精确有理数/十进制字符串，**同时**给一个 number 供显示。偏移常量从 `scenario/lib/mock-feed.ts` **搬到这里**，让 `scenario` 反过来 import 它(保证只有一份)；`scenario` 现有测试必须仍然通过 |
| `src/store/accounts.ts`(改) + `src/store/involved.ts`(改) | `snapshotAccounts` 之外增加预言机快照：对已解码 bank 的 `oracle_keys[0]`(非全零)取账户，**owner 必须在允许集合内**(读取 `ORACLE_OWNERS` 环境变量，逗号分隔；默认取 `program/out/program-ids.json` 的 `mocks` 和已知 Switchboard devnet 程序 `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2`，文件不存在时只用后者)，解码后写 `account_states(type = 'switchboardPullFeed')`。owner 不在集合内拒绝写入并报告 |
| `src/store/migrations/003_labels.sql` + `scripts/load-labels.ts` | `labels(address PRIMARY KEY, label TEXT NOT NULL, kind TEXT)`。链上没有代币符号和账户昵称，标签是**链下元数据**；`load-labels` 从 `fixtures/m1-run.json` 的 `addresses` 读出 mint / bank / marginfiAccounts / actors 并写入(例:`tUSDC`、`tSOL`、`bank tUSDC`、`alice`、`bob`、`carol`)。幂等(`ON CONFLICT DO UPDATE`) |
| `src/api/math.ts` | 纯函数：`curveRate(utilization, curve)`、`rates(utilization, curve)`(lending / borrowing APR)、`share_value × shares → 原生单位`(bigint 精确，向下取整)、`health(balances, banks, prices, 'init'|'maint')`。**不经过浮点计算原生数量**；USD 与 APR 才转 number |
| `src/api/queries.ts` | 读库并组装契约里的各个视图：`getPool`、`getRateCurve(bank)`、`getAccounts`、`getActivity({ limit, before })`、`getXray(signature)`。只依赖 `Db` |
| `src/api/spans.ts`(或放 `src/decoder/`) | 为指令数据生成 `ByteSpan[]`：先 8 字节 discriminator，再 **IDL 参数逐个**(顶层字段即可)的 `offset/length/label/hex/value`。由 IDL 驱动，复用 `borsh.ts` 的读取；`value` 里 bigint 转字符串。断言：各 span 首尾相接、总长等于数据长度 |
| `src/api/server.ts` + `scripts/serve-api.ts` | `node:http` 手写路由(不加框架依赖)：`GET /api/pool`、`/api/rate-curve?bank=`、`/api/accounts`、`/api/activity?limit=&before=`、`/api/tx/:signature`、`/api/health`。JSON 序列化 bigint 为字符串；CORS 允许 `http://localhost:5173`；未知路径 404、参数错误 400，错误体 `{ "error": "..." }`；绝不把 `DATABASE_URL`、`RPC_URL` 写进响应或日志。端口默认 8787(`PORT`) |

### 行为细节

- **价格缺失**时 `price`、`*_usd` 为 `null`，不能当 0；健康度里缺价格的资产 → 该账户 `health` 字段为 `null`、`status` 取 `no_debt`/`healthy` 之外的保守处理(在注释写明你的选择)。
- `utilization = total_borrows / total_deposits`(用原生数量的精确比值算，再转 number)；存款为 0 时取 0。
- `status`：没有任何负债 → `no_debt`；`maint >= 0` → `healthy`；否则 `liquidatable`。
- `getActivity`：按 `slot` 降序、同 slot 按 `ix_index` 降序；一条指令一行(`instructions` 表顶层行)，`event` 取同一 `ix_index` 下与指令对应的主事件(deposit/borrow/repay/withdraw/liquidate/create 等)，`amount` 取事件的 `amount`(u64 字符串)，清算(f64)为 `null`；`account` 取事件头里的 `marginfi_account`，`bank` 取事件的 `bank`；失败交易 `ok=false`。游标用 `before=<slot>:<ix_index>:<signature>` 之类的稳定组合，翻页不重不漏(测试覆盖)。
- `getXray`：`instructions[]` 来自 `raw_tx.tx` 里的指令(含 inner)与 `instructions` 表的解码；`data_base58` 是 RPC 原文，`data_hex` 由它算出；`events[].base64` 是日志里 `Program data:` 的原文；`rows` 是两张表的原始行。**三种形态必须互相能对上**(测试：把 `data_hex` 重新解码应得到同样的 `args`)。签名不存在 → 404。

## 测试(`node:test`,放在对应文件旁,全部离线,PGlite)

1. **健康度金标准**(最重要)：用 `fixtures/m1-run.json` 里 `LendingAccountLiquidateEvent` 的 `pre_balances` / `post_balances`(f64)、当时价格(tSOL=$50、tUSDC=$1)和从 `m1-accounts.json` 解出的 bank 权重，算 Bob 的维持健康度，必须与事件里程序自己报告的 `liquidatee_pre_health`(−750.0017…) 和 `liquidatee_post_health`(−701.2517…) 在 `1e-6` 内相等。注意事件里的数量是 f64 原生单位，需除以 `10^decimals`。
2. **利率**：`curveRate` 在 0、optimal、1 三点及两段内部的手算值；`rates` 的 lending = base×util，borrowing = base×(1+fee_ir)+fee_fixed；利用率 > 1 或 NaN 要有明确处理。费用求和与上游源码对照，在注释里写清来自哪几行。
3. **池子视图**(用 `m1-accounts.json` + 价格快照)：两个 bank 的 `total_deposits`/`total_borrows` 原生数量，与 `snapshots`(Anchor 解出)的 `shares × share_value` 有理数结果一致；`utilization` 在 0..1。tSOL bank 的存款应为 100 tSOL(Bob 90 + Carol 10)，tUSDC bank 的借款为 0(已还清)——请用 fixture 里真实数字核对，不要凭我这段话。
4. **账户视图**：Bob / Alice / Carol 的 `deposit`/`borrow` 与 `snapshots.accounts[*].quantities` 一致；Bob `status` 为 `no_debt`(已 repay_all)，把价格改成 $50 并构造一个仍有负债的合成账户时为 `liquidatable`。
5. **活动流**：入库 32 笔 fixture 交易后，`getActivity` 总行数 = 18，指令名分布与 `m1-run.json` 独立核对；分页遍历得到的集合与不分页一致，无重复无遗漏。
6. **X 光**：对 borrow 与 liquidate 各取一笔，`spans` 首尾相接且总长 = 数据长度；`data_hex` 重新解码得到与 `args` 相同的值；`events[].base64` 能由 `decodeEvents` 的输入日志逐字对上；不存在的签名返回 404。
7. **HTTP**：不用真实 socket(沙箱可能禁止)，直接调用请求处理函数(`handle(req, res)` 用最小替身，或把路由做成 `(method, url) => { status, body }` 的纯函数)，覆盖 200 / 400 / 404、CORS 头、bigint 序列化、响应中不含 `api-key` / `DATABASE_URL` 字样。
8. **预言机**：`decodePullFeed` 对 `fixtures/switchboard-pullfeed-uncranked.bin`(未 crank，价格 0)和一个由 `scenario` 的 `resultRegion` 构造的账户(价格 100)都给出正确结果；owner 不在允许集合内被拒绝。
9. **突变验证**：本地临时改坏至少三处并确认测试失败再还原，例如：健康度里把维持权重换成开仓权重、利率公式漏掉固定费用、`status` 判断反向、`spans` 少一个字段；在汇报里写明。

## 代码要求

- 教学片段用 `// #region ep7-xxx`(至少:`ep7-rates`、`ep7-health`、`ep7-spans`、`ep7-xray`)。
- 单文件尽量不超过约 150 行(`queries.ts` 可拆成多个文件)。不新增依赖，不联网，不发送交易。
- `pnpm typecheck` 与 `pnpm test` 必须通过。
- 更新 `docs/progress.md`(新增 M5a 一行)、`docs/chapters/ep07-frontend.md` 的后端部分，在 `docs/decisions.md` 追加 D-013(设计取舍、没有验证的部分)。
- 不要提交 git。
