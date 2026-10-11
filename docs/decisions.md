# 决策与核实记录

每条记录:结论 + 依据 + 日期。"待验证"的事实核实后移到这里。

## D-001 许可证(已核实,2026-10-11)

上游 `marginfi-v2` 为 Apache-2.0(本机克隆 `../marginfi-v2/LICENSE`)。可以 fork 与再分发,需保留许可与版权声明。本项目自身的许可证尚未选定。

## D-002 mrgn-0.1.0 的构建工具链(已验证,2026-10-11)

**结果**:用 solana 2.1.20 的 `cargo-build-sbf` + 上游要求的 rust 1.75 可以成功构建 marginfi 与 mocks,不需要 solana 1.18.17 / anchor 0.30.1 CLI。`program/build.sh` 已跑通。构建时 spl-token-2022 会报栈帧超限提示(confidential transfer),只影响该路径,不影响本项目用到的指令;未实测。

以下为核实前的分析:

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

**已核实源码(2026-10-11)**:
- `PythLegacy` 读取价格时要求账户 owner 等于 `PYTH_ID`(`state/price.rs` `load_pyth_price_feed`)。
- `PYTH_ID` 与价格新鲜度检查由 cargo feature 决定:`devnet` / `mainnet-beta` / `staging` 下是真实 Pyth 程序且**检查价格时间**;**不带这三个 feature 的构建(localnet 模式)**下 `PYTH_ID` 是上游自带的 `programs/mocks` 程序,且**忽略价格时间**(`live!()` 为假)。
- 上游自带 `programs/mocks`,可以写出 Pyth 布局的价格账户。

**方案**:不带 cluster feature 构建 marginfi(`--no-default-features`);同时部署 `mocks`;由于上游 mocks 与 marginfi 的原始 program id 我们没有私钥,构建时把 `declare_id!` 和 `PYTH_ID` 补丁成自己的 keypair。效果:价格永不过期,可随时用 mocks 改价,不依赖 Pyth / Switchboard。

**待验证**:补丁后的构建能否通过;mocks 的指令能否创建并更新价格账户。

## D-004 账户布局(部分核实)

`MarginfiGroup`、`Bank` 在 mrgn-0.1.0 中为 `zero_copy`(已看到源码属性),按固定偏移与对齐存储,余额用 `WrappedI80F48` 定点数。`MarginfiAccount` 预计同样,**待核实**。EP5 的账户解码需要手写偏移表。

## D-005 事件(已核实)

mrgn-0.1.0 的 `events.rs` 定义了 18 个事件,涵盖创建、配置、deposit / borrow / repay / withdraw / liquidate、利息累计、破产处理等。`lib.rs` 中共 36 个指令入口。具体事件的发出方式(日志 `Program data` 或 CPI)待在源码中确认。

## D-006 技术选型

TypeScript 全栈(剧本、indexer、前端),Postgres,依赖版本固定。Solana JS SDK 在 `@solana/web3.js` 1.x 与 `@solana/kit` 之间二选一,**待定**,选定后锁版本并记录于此。

## D-007 devnet 价格改用 Switchboard(用户决策,2026-10-11)

用户要求部署到 devnet 时代币价格走 Switchboard。这与 D-003 的 mock 方案不同,两者并存:

- **本地/确定性重放(fixtures、对账)**:仍用 mocks,价格不过期,结果可复现。
- **devnet 演示**:需带 `devnet` feature 构建(此时检查价格时间,`SWITCHBOARD_PULL_ID` 为 devnet 地址,源码 `constants.rs` 另有 mainnet 地址),并让每笔涉及价格的交易前先更新 feed。

**待验证(风险)**:
1. 能否在 devnet 为自建代币创建 Switchboard On-Demand feed,并用固定值任务得到可控价格。我没有实测,不确定是否稳定。
2. `devnet` feature 同时会把 marginfi 的 program id 与 Pyth id 换成上游固定值,`build.sh` 的补丁需要覆盖这些分支。
3. 价格有最大有效期,录制时每次借贷前都要先更新,剧本要加这一步。
