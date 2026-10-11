# EP5 解析事件与账户状态

状态：M3 离线完成（2026-10-12）；实测数字、推断与未验证项见 [D-011](../decisions.md#d-011-m3-事件zero_copy-账户与精确对账离线实测2026-10-12)。

## 本章要回答的一个问题

事件告诉我们“发生了什么”，账户状态告诉我们“现在是什么”。为什么池子指标必须以状态为准？因为普通事件不含逐账户利息，清算事件又损失定点精度并漏报部分余额；事件净流量与结束余额确实不同。

## 概念

1. **日志调用栈**：顶层 `invoke [1]` 增加指令下标；CPI `invoke [2]` 进入子程序，`success` / `failed` 出栈。只有栈顶等于 IDL 的 marginfi 地址，`Program data:` 才归它。不要从日志文本猜归属。失败交易回滚，即使日志已有事件也不入活动流。
2. **Borsh vs zero_copy**：事件是 `[8 字节 discriminator][连续 Borsh 字段]`；账户是 `[8 字节 discriminator][repr(C) 成员与 padding]`。公钥大小 32、对齐 1；u64 大小/对齐 8；WrappedI80F48 大小 16，却因 `repr.align=8` 按 8 对齐。数组 stride 包含元素尾部 padding。
3. **份额 vs 数量**：I80F48 位数为 `有符号 i128 / 2^48`；数量为 `shares位数 × share_value位数 / 2^96`。不经过 Number。事件中的 f64 已经舍入，只能保留其 binary64 真值，无法恢复丢失的 I80F48 位。

## 代码走读

事件 discriminator 由 IDL `events[]` 匹配，字段用 Borsh；未知事件保留原始 base64，损坏事件保留 `decodeError`。

{{ snippet src/decoder/event.ts#ep5-event-parse }}

调用栈与顶层归属。`decodeEvents` 返回 `{ events, truncated }`：截断是交易级元数据，即使没有事件也保留；遇到运行时 `Log truncated` 后停止消费日志。

{{ snippet src/decoder/event.ts#ep5-log-stack }}

账户按 IDL 动态计算布局，无硬编码偏移表。以下 offset 从结构体起点算，定位原始账户字段时还要加 8。

{{ snippet src/decoder/layout.ts#ep5-layout }}

padding 有两种：IDL 的 `_pad` / `_padding` 是真实字段；编译器为成员/尾部对齐补的空隙不算字段。固定账户里大量 padding 已显式写出，隐式补齐用合成结构测试，不要把所有空字节说成编译器自动插入。

{{ snippet src/decoder/layout.ts#ep5-padding }}

精确显示：分母 `2^48` 对应最多 48 位十进制小数，负号由二补码解析得到。

{{ snippet src/core/fixed.ts#ep5-fixed }}

对账先断言 shares 原始位数，再计算数量有理数。`event-balances.ts` 将 u64 净流量与 f64 清算调整分开；`reconcile.ts` 保留差值和来源分类，报告无法解释的方向/量级。

{{ snippet src/decoder/reconcile.ts#ep5-reconcile }}

## 运行与验证

全部命令离线，不需要 RPC、钱包、Postgres。

```bash
pnpm exec node --import tsx scripts/print-layout.ts Bank
pnpm exec node --import tsx scripts/print-layout.ts FeeState
pnpm exec node --import tsx scripts/decode-account.ts F99hSfDM9ymMiMshg38uKWRpXtmZ7rSKVX5F1aHkjWTb
pnpm typecheck
pnpm test
```

预期：Bank `size=1856 align=8`，FeeState `size=256 align=8`；布局表含 offset / size / align / previousEnd / padding 及 tailPadding。账户 CLI 输出 `name: Bank` 和 snake_case 字段，所有整数序列化为字符串，WrappedI80F48 输出原始 `value` 字节与精确 `decimal`。账户字节长度必须严格等于布局大小加 8，未知 discriminator 不抛错。解码器仅收到字节，owner 必须由未来调用者核对。

测试对照 32 笔交易的 **25 条**事件与运行时 Anchor EventParser、七份账户所有字段与测试专用 Anchor coder。任务文件的 24 条与 fixture 不符，实测更正见 D-011。两个池子的四个 shares 不变量、四个 active 组合的数量分子均精确通过。

| 账户 / 池子 | 存款差（原生单位，显示约值） | 借款差（原生单位） |
|---|---:|---:|
| Alice / tUSDC | +1546.589030384 | 0 |
| Bob / tUSDC | 0 | +2176.00000095367431640625 |
| Carol / tUSDC | +348.538911789 | 0 |
| Alice / tSOL | 0 | 0 |
| Bob / tSOL | 0 | 0 |
| Carol / tSOL | 0 | 0 |

差为“状态减事件净流量（含清算调整）”，不是 decoder 错误。三个正差符合最终 share value 的利息方向与上界；Bob 还包含 repay_all 的 ceil，Carol 清算存款消耗按 39/38 推算。代码保留精确分子，测试固定非零差及方向/量级，没有扩大容差来消掉差值。

四种临时实现突变均使测试失败并已还原：字段偏移 +8、定点位数经 Number、失败交易仍产事件、清算忽略保险费比例。最终检查结果见 [进度](../progress.md#m3-离线验收2026-10-12)。

## 常见坑与验证边界

- 计息事件和借款事件可能属于同一借款指令，不能一事件一顶层指令；外部 CPI 的 `Program data` 也不能误解码。CPI、失败与日志截断的边界只用合成日志验证。
- repay_all 关闭余额后，不要把事件累计净流量设为零；还款整数包括利息与 ceil。`scenario/expected.ts` 保持不动，f64 残留来自链上事件本身。
- 39/38 是名义清算折扣比。没有中间账户快照，未精确重演上游利息、I80F48 常数/截断和份额转换，不能声称已精确分摊差值。分类的 `f64Bound` 是半 ULP 的理论传播界，不是实际误差或可随意放宽的测试容差。
- 利息上界假设从零建仓、share value 从 1 单调增加且没有其他费用；这是本剧本的解释，不覆盖破产、withdraw_all、非零开仓费或 Token-2022 费用。其他事件/账户版本/枚举值还没有真实样本。
- 本次没有联网、重跑剧本、部署或发送交易，也没有检查最新链上状态。

下一章将保存原始交易，再离线重放 decoder 入库；池子指标读取账户状态，活动流读取事件。
