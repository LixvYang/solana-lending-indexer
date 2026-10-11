# 决策与核实记录

每条记录:结论 + 依据 + 日期。"待验证"的事实核实后移到这里。

## D-001 许可证(已核实,2026-10-11)

上游 `marginfi-v2` 为 Apache-2.0(本机克隆 `../marginfi-v2/LICENSE`)。可以 fork 与再分发,需保留许可与版权声明。本项目自身的许可证尚未选定。

## D-002 mrgn-0.1.0 的构建工具链(已核实,待实际构建验证)

上游 tag `mrgn-0.1.0` 存在。该 tag 要求:

| 项 | 要求 | 本机 |
|---|---|---|
| anchor | 0.30.1 | 默认 1.0.0;avm 可安装 0.30.1 |
| solana | 1.18.17 | 已装 2.1.20、3.1.x,无 1.18.17 |
| rust | 1.75.0(`rust-toolchain.toml`) | 有 1.78、1.79,无 1.75 |

本机 `../marginfi-v2` 的 HEAD(约 0.1.8)要求 anchor 0.31.1 + solana 2.1.20,这两个本机都有。

备选方案(M0 时按顺序尝试):
1. 为 mrgn-0.1.0 单独安装 1.75 / 1.18.17 / 0.30.1 后构建。
2. 若失败,改用更新的 tag(例如 0.1.x 中工具链本机可满足的),并在 EP3 如实说明。
3. 若仍失败,直接使用 HEAD,放弃"0.1.0 更简单"的卖点,但解码器与剧本不变。

## D-003 价格来源(设计决策,待验证可行性)

不使用 Switchboard devnet 手动设价:feed 需要 oracle 持续喂数据,手动设价不稳定。

mrgn-0.1.0 的 `OracleSetup` 只有 `None / PythLegacy / SwitchboardV2 / PythPushOracle / SwitchboardPull / StakedWithPythPush`,**没有固定价格模式**。因此只能让程序读到"自己构造的、格式符合要求的价格账户"。

候选:构造 Pyth 旧版 price 账户并写入固定价格。**待验证**:程序是否校验账户 owner / 发布时间;若校验则此路不通,需要换方案(例如用自己部署的程序拥有该账户,或改用较新的带固定价格模式的版本)。

## D-004 账户布局(部分核实)

`MarginfiGroup`、`Bank` 在 mrgn-0.1.0 中为 `zero_copy`(已看到源码属性),按固定偏移与对齐存储,余额用 `WrappedI80F48` 定点数。`MarginfiAccount` 预计同样,**待核实**。EP5 的账户解码需要手写偏移表。

## D-005 事件(已核实)

mrgn-0.1.0 的 `events.rs` 定义了 18 个事件,涵盖创建、配置、deposit / borrow / repay / withdraw / liquidate、利息累计、破产处理等。`lib.rs` 中共 36 个指令入口。具体事件的发出方式(日志 `Program data` 或 CPI)待在源码中确认。

## D-006 技术选型

TypeScript 全栈(剧本、indexer、前端),Postgres,依赖版本固定。Solana JS SDK 在 `@solana/web3.js` 1.x 与 `@solana/kit` 之间二选一,**待定**,选定后锁版本并记录于此。
