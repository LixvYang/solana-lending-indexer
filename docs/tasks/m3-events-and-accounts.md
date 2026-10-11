# 任务 M3:事件与账户状态解码(EP5)

交给 codex 实现。先读 `AGENTS.md`、`docs/00-goals.md`、`docs/decisions.md`(尤其 D-004、D-005、D-009、D-010)、`docs/chapters/ep05-events-and-accounts.md`,并浏览 M2 已实现的 `src/core/*`、`src/decoder/*`(沿用其风格:手写、纯函数、文件小、snake_case 保持 IDL 原样)。

## 目标

两件事,以及一条把它们连起来的对账:
1. **事件**:从交易日志里的 `Program data:` 还原 marginfi 的 Anchor 事件("发生了什么")。
2. **账户状态**:把账户原始字节还原成结构化数据("现在是什么")。marginfi 的 `Bank`、`MarginfiGroup`、`MarginfiAccount`、`FeeState` 是 **`zero_copy`(`repr(C)`)**,**不是 Borsh**:字段按固定偏移和对齐摆放,有 padding。
3. **对账**:证明事件和状态讲的是同一个故事。这是 EP5 的结论——池子指标要以状态为准,事件只做活动流。

`src/` 里依旧**不依赖 Anchor**;Anchor 只在测试里做独立对照。

## 输入(全部离线)

- `fixtures/m1-transactions.json`:32 笔 RPC 原始交易(含 `meta.logMessages`)。
- `fixtures/m1-accounts.json`:剧本结束后 7 个账户的原始字节(base64,**含 8 字节 discriminator**):1 个 group(1064)、1 个 feeState(264)、2 个 bank(1864)、3 个 marginfiAccount(2312)。
- `fixtures/m1-run.json`:
  - `events`:剧本运行时由 **Anchor `EventParser`** 解出的事件(24 条)——事件对照基准。
  - `snapshots`:运行时由 **Anchor 账户 coder** 解出的 bank / marginfiAccount,以及每个账户每个 bank 的 `depositNumerator` / `borrowNumerator`(= shares × share_value 的有理数分子,分母 `2^96`)——账户对照基准。注意 snapshots 里的键是 camelCase(来自 Anchor 的 `program.coder`),而我们的输出保持 IDL 的 snake_case,比较时自己做转换。
- IDL:`src/decoder/idl/marginfi.idl.json`,其中 `events[]` 带 discriminator,`types[]` 带 `serialization` / `repr`(例如 `WrappedI80F48` 是 `repr(C, align(8))`)。
- 上游 Rust 源码只读参考:`program/.upstream/programs/marginfi/src/state/`(`marginfi_group.rs`、`marginfi_account.rs`、`fee_state.rs`),用来理解对齐与 padding,**偏移不能凭源码口算,必须以 fixture 字节验证**。

## 要实现

| 文件 | 内容 |
|---|---|
| `src/decoder/borsh.ts`(改) | 增加 `f64`(和 `f32`)。事件里有 f64:例如清算事件的 `liquidatee_pre_health`、`LiquidationBalances.*`,`LendingPoolBankAccrueInterestEvent` 的 `fees_collected` |
| `src/decoder/event.ts` | `decodeEvents(rpcTx, idl)`:遍历 `meta.logMessages`,用 `Program <id> invoke [n]` / `success` / `failed` 维护**调用栈**,只处理栈顶是 marginfi 时出现的 `Program data: <base64>`;前 8 字节匹配 IDL `events[].discriminator`,其余按 Borsh 解码。每条输出 `{ signature, name, data, ixIndex, logIndex }`,`ixIndex` 为该事件所属的**顶层指令下标**(数 `invoke [1]`)。未知 discriminator → `{ name: 'unknown', … }`,不抛错;**交易 `meta.err` 非空时不产出事件**(并在注释写明原因);遇到 `Log truncated` 时标记 `truncated: true` |
| `src/decoder/layout.ts` | **由 IDL 计算 zero_copy 布局**:给定类型名,按 `repr(C)` 规则求每个字段的 `offset` / `size` / `align` 与整个结构的大小。基本类型对齐 = 自身大小(`pubkey` 对齐 1、大小 32);数组 = 元素对齐;结构体对齐 = 成员最大对齐(`WrappedI80F48` 的 `repr.align = 8`);无字段枚举按 1 字节处理(待 fixture 验证)。**不要把偏移表写死**,算出来;注释解释"为什么这里有 padding" |
| `src/core/fixed.ts` | `WrappedI80F48`(16 字节小端,有符号,48 位小数)→ 精确十进制字符串(bigint 运算,**不经过 Number**),以及 `toRational(bytes) => { numerator, denominator: 2n**48n }` |
| `src/decoder/account.ts` | `decodeAccount(data, idl)`:按前 8 字节 discriminator 判断类型(Bank / MarginfiGroup / MarginfiAccount / FeeState;其余类型返回 `unknown`),按 `layout.ts` 的偏移解码。**长度必须等于 `8 + 结构大小`,否则返回 decodeError(不抛错)**。`WrappedI80F48` 保留原始字节并附精确十进制字符串 |
| `src/decoder/reconcile.ts` | `reconcile(events, accounts)`:见下节 |
| `scripts/decode-account.ts` | `pnpm exec node --import tsx scripts/decode-account.ts <账户地址>`:从 `fixtures/m1-accounts.json` 取出并打印解码结果(bigint 转字符串)。视频演示用 |
| `scripts/print-layout.ts` | 打印某个类型的偏移表(字段名 / offset / size / align / 前一字段结束位置与 padding)。EP5 讲"为什么有 padding"用 |

## 对账(EP5 的核心结论,写严谨)

1. **精确不变量(必须通过)**:对每个 bank,三个用户账户里该 bank 的 `asset_shares` 之和 == bank 的 `total_asset_shares`,`liability_shares` 之和 == `total_liability_shares`——**按 I80F48 原始位数相等**,不是近似。这个不变量与利息无关。
2. **与 Anchor 快照一致**:我们由原始字节算出的每账户每 bank 的 `shares × share_value`(有理数)必须与 `m1-run.json` 的 `depositNumerator` / `borrowNumerator` **完全相等**。
3. **事件与状态的差**:对每个账户每个 bank,把事件里的 deposit / withdraw / borrow / repay(这些是 u64,精确)累加成净额,和由状态算出的数量比较。**不要假设相等**:存款会赚利息、借款会付利息、清算事件里的数量是程序用 **f64** 发出的(本身就有精度损失,例如 `5512499999.999999`)。请**实测**每个差值,在 `reconcile.ts` 里把差值分类(利息 / f64 精度 / 其他),断言差值方向与量级,并在 `docs/decisions.md` 记录实测数字和你的解释。**解释不了的差值必须报告,不要靠放宽容差让测试变绿。**
4. 不要修改 `scenario/expected.ts`;f64 残留来自链上事件本身,不是那里的 bug,请在 D-011 里写明。

## 测试(`node:test`,放在对应文件旁,`pnpm test` 自动发现,全部离线)

1. **事件与 Anchor 对照**:对 32 笔 fixture,`decodeEvents` 的结果与 `m1-run.json` 的 `events` 逐条一致(数量 24、名称、顺序、字段值;pubkey 与数值用同一规则标准化)。
2. 每个事件的 `ixIndex` 指向的顶层指令,其解码出的指令名与事件类型相符(例如 borrow 事件 ↔ `lending_account_borrow`;用 M2 的 `decodeTransaction`)。
3. 合成日志:调用栈(marginfi 被别的程序 CPI、日志里夹杂其他程序的 `Program data:` 不能误解码)、失败交易不产出事件、未知 discriminator、`Log truncated`。
4. **布局**:`layout.ts` 算出的 Bank / MarginfiAccount / MarginfiGroup / FeeState 的总大小 + 8 == fixture 账户字节长度(1864 / 2312 / 1064 / 264);`WrappedI80F48` 对齐为 8。
5. **账户与 Anchor 对照**:7 个账户的 `decodeAccount` 结果与测试里 `BorshCoder.accounts.decode`(用 PascalCase 名 `Bank`、`MarginfiAccount`、`MarginfiGroup`、`FeeState`,字段为 snake_case)逐字段一致。
6. 精确定点数:`fixed.ts` 对手写样本(含负数、小数部分)给出精确十进制字符串。
7. 对账:上节第 1、2 点精确断言;第 3 点按实测分类断言。
8. 突变验证:你自己在本地临时改坏一处(例如把某字段偏移 +8、把 `WrappedI80F48` 当 Number 转),确认测试会失败,再还原;在汇报里写明做了哪几种突变。

## 代码要求

- 教学片段用 `// #region ep5-xxx` / `// #endregion`(至少:`ep5-event-parse`、`ep5-log-stack`、`ep5-layout`、`ep5-padding`、`ep5-fixed`、`ep5-reconcile`)。
- 单文件尽量不超过约 150 行;注释讲"这几个字节是什么、为什么"。不新增依赖,不联网,不发送交易。
- `pnpm typecheck` 与 `pnpm test` 必须通过。
- 完成后更新 `docs/progress.md` 的 M3 一行与 `docs/chapters/ep05-events-and-accounts.md`,在 `docs/decisions.md` 追加 D-011(M3 实测结论),并**如实写出没有验证的部分**。
- 不要提交 git。
