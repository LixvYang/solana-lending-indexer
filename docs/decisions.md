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

TypeScript 全栈(剧本、indexer、前端),Postgres,依赖版本固定。M1 使用现有已安装并锁定的 `@solana/web3.js` 1.95.8 与 Anchor 0.31.1(2026-10-11)，没有修改依赖版本。

## D-007 devnet 价格改用 Switchboard(用户决策,2026-10-11)

用户要求部署到 devnet 时代币价格走 Switchboard。这与 D-003 的 mock 方案不同,两者并存:

- **本地/确定性重放(fixtures、对账)**:仍用 mocks,价格不过期,结果可复现。
- **devnet 演示**:需带 `devnet` feature 构建(此时检查价格时间,`SWITCHBOARD_PULL_ID` 为 devnet 地址,源码 `constants.rs` 另有 mainnet 地址),并让每笔涉及价格的交易前先更新 feed。

**待验证(风险)**:
1. 能否在 devnet 为自建代币创建 Switchboard On-Demand feed,并用固定值任务得到可控价格。我没有实测,不确定是否稳定。
2. `devnet` feature 同时会把 marginfi 的 program id 与 Pyth id 换成上游固定值,`build.sh` 的补丁需要覆盖这些分支。
3. 价格有最大有效期,录制时每次借贷前都要先更新,剧本要加这一步。

## D-008 M1 源码核实与离线构造(2026-10-11)

- `program/.upstream/programs/marginfi/src/state/marginfi_group.rs::get_oracle_max_age` 只有旧 SwitchboardV2 与 Pyth 分支在 0 时返回默认值；**SwitchboardPull 为 0 时返回 0**。剧本显式设为 240 秒，使用前独立 crank，实际有效期窗口待链上验证。
- `lending_pool_add_bank` 的 `BankConfigCompact` 不含 oracle；按 IDL / `tests/utils/group-instructions.ts` 先 add bank，再 `lending_pool_configure_bank_oracle(4, feed)`。全局 FeeState 是创建 group 的前置条件，来源 `tests/rootHooks.ts` / `instructions/marginfi_group/initialize.rs`，缺失时在步骤 3 初始化。
- 资产权重 tSOL 0.8 / 0.9，负债权重 tUSDC 1.1 / 1.05，使 100 tSOL 按 $100 抵押借 5000 tUSDC 的初始健康度约 +2500 美元，按 $50 的维持健康度约 -750 美元(未计利息)。利率参照 `tests/utils/types.ts`，开仓费设为 0。
- `state/marginfi_account.rs::check_post_liquidation_condition_and_get_account_health` 禁止一次清算清空负债或越过维持线。因此清算 10 tSOL，再由 Bob `repay_all` 收尾。账户 observation 顺序来自 `tests/utils/user-instructions.ts` / `instructions/marginfi_account/liquidate.rs`；真实 IDL 的离线构造与序列化长度已检查，**不代表链上交易已验证**。

## D-009 事件对账的限制(源码核实,2026-10-11)

`events.rs` 的普通借贷事件只报告本次数量；计息事件不含逐账户利息；`LiquidationBalances` 用 f64，且只报告清算人的资产 bank 存款 / 负债 bank 借款，没有其负债 bank 的存款。来源 `instructions/marginfi_account/liquidate.rs` 与 `constants.rs`：清算人支出使用 0.975 折扣，被清算人减债使用 0.95 折扣，差额进保险。因此 M1 expected 记录事件净流量并用 39/38 推算清算人支出，同时保存 Anchor 账户快照中的有理数原生余额。精确链上对账仍待验证，不把事件净流量标记为真实结束余额。

## D-008 Switchboard devnet 队列当前不可用(实测,2026-10-11)

**现象**:剧本第 2 步(创建 feed 后 crank)失败。逐层排查:
1. SDK 默认的 Crossbar 域名 `crossbar.switchboard.xyz` 已解析不到;换 `crossbar.switchboardlabs.xyz` 后 `/store`(v1)可用,feed 账户创建成功。
2. 该 Crossbar 的 `/gateways?network=devnet` 返回 `[]`,SDK 报 "No gateways available"。
3. 改为读链上队列登记的 gateway:9 个 oracle 的 gateway 地址在 TLS 握手阶段全部无响应(同一 IP 换成别的 SNI 则握手正常,所以不是本机网络问题)。
4. 查链上心跳:队列 `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` 的 `nodeTimeout` 为 300 秒,而 9 个 oracle 的最后心跳距今:5 个约 39 小时(140018–140363 秒),其余约 25、31、46、55 天。**最新的也已超过 1.6 天**。

**结论**:devnet 上没有存活的 Switchboard oracle,crank 目前做不到,不是代码问题。参考项目 `usdx-solana` 在 2026-09-14 实测时队列心跳还是"刚刚",说明这是之后才出现的变化。

**已知的副产物(已修,保留)**:`CROSSBAR_URL` 可配置;crank 改为读链上 gateway;创世哈希写错的 bug。

**未验证**:oracle 何时恢复;Switchboard 是否还有别的 devnet 队列可用。

### D-008 补充:进一步核实(2026-10-11)

- 链上共 191 个 devnet Switchboard oracle 账户,**全部**心跳不新鲜,最新的距今约 39 小时(5 个几乎同时停止,像是同一次故障)。
- `crossbar.switchboard.xyz`(官方文档仍写它是公共地址)经 Cloudflare DoH 确认**没有任何 DNS 记录**。`crossbar.switchboardlabs.xyz` 可用于 `/store`,但 `/gateways?network=devnet` 为空。
- 官方 agent skill 文档推荐的新路径是 `queue.fetchManagedUpdateIxs(crossbar, [feedId], …)`(oracle quote),同样依赖存活的 oracle,不能绕开。
- SDK 只登记一个 devnet 队列(`EYiAmGSd…`)。
- 官方文档建议生产环境自建 Crossbar;自建只能解决 Crossbar,解决不了 oracle 离线。
- 软件侧无法绕开:feed 账户归 Switchboard 程序所有,只有它能写入价格。

**可行的替代(未实施)**:marginfi 对价格账户只检查 owner 与布局。上游 `mocks` 程序有通用的 `write(offset, data)` 指令,可以让账户归 mocks 所有、内容是 Switchboard `PullFeedAccountData` 的 3208 字节布局,构建时把 `SWITCHBOARD_PULL_ID` 补丁成 mocks 的地址。这样 marginfi 走的仍是 SwitchboardPull 解析路径,只是"crank"换成我们自己写入。需要把 marginfi 以这个补丁重新升级部署(同一程序地址)。

## D-009 价格方案落地:Switchboard 布局的 mock 价格账户(2026-10-11,已在 devnet 验证)

采用 D-008 的替代方案。**实测结果**:marginfi(以 `PRICE_ORACLE=mock` 补丁、`devnet` feature 构建并升级到原地址)接受 mocks 程序拥有、按 `PullFeedAccountData` 布局写入的价格账户,SwitchboardPull 解析路径正常工作;12 步剧本在 devnet 一次跑通(32 笔交易全部 finalized,覆盖 deposit / borrow / repay / withdraw / liquidate / accrue)。

- 偏移表用链上真实账户 `fixtures/switchboard-pullfeed-uncranked.bin` 校验(authority、queue、name、min_responses、max_staleness 全部对上)。
- 价格由 mocks 的 `write(offset, data)` 写入，目标账户须签名；"crank" 即用链上时间重写时间戳与 slot。
- 改价(tSOL 100 → 50)直接重写价格区域，不需要重配 Bank。清算按预期触发。
- 切回真实 Switchboard:`PRICE_ORACLE=switchboard ./program/build.sh` 重新构建升级，剧本设 `PRICE_PROVIDER=switchboard`。**该路径只验证到 feed 创建，crank 从未成功**。
- `SWITCHBOARD_PULL_ID` 与程序地址都是补丁值；视频里必须说明这是"布局一致的 mock"，不能说成真实 Switchboard 价格。

已知小问题:`expected` 里清算相关的数量带有 f64 精度残留(例如 `5512499999.999999`)，M3 对账前需要改成整数/定点运算。

## D-010 M2 指令布局与离线交叉校验（2026-10-12）

- 固定 IDL 的全部 36 个 discriminator 与手算 `sha256("global:<snake_case 名称>")` 前 8 字节一致。依据：`src/decoder/discriminator.test.ts`。
- 指令可达类型实际为 bool、pubkey、u8/u16/u32/u64、option、array、defined struct/enum；`WrappedI80F48` 参数按 IDL 的 `{ value: u8[16] }` 保留字节，不套用账户 zero_copy 对齐或换算小数。依据：固定 IDL 与 `src/decoder/borsh.ts`，fixture 的 BankConfigCompact 与 Anchor coder 解码一致。
- 32 笔原始 RPC fixture 中共 18 条 marginfi 指令、11 类，名称与参数逐条与测试专用 `BorshCoder.instruction.decode` 一致。步骤金标准对照 `m1-run.json` 的独立事件记录；borrow 与 liquidate 的角色地址/remaining 顺序与 addresses 一致。依据：`src/decoder/transaction.test.ts`。
- 输出的指令名、参数/结构体/枚举字段保持原始 IDL 拼写，账户角色名也保持 IDL 原样的 snake_case(审查时统一:此前账户名被转成 camelCase 而参数名不是,风格不一致;snake_case 与 Rust、IDL、以后的数据库列名一致)。数值为 bigint；原始 bytes 与 WrappedI80F48 字节为 number[]。非法 base58 无法恢复字节，错误结果保留 RPC 原文并注明编码；不足 8 字节无法识别名称，按 unknown 错误保留原始字节。
- 非空 v0 loadedAddresses、嵌套账户分组、marginfi inner instruction 仅用合成数据验证。其余指令没有链上样本。审查时补了往返测试 `src/decoder/roundtrip.test.ts`:对全部 23 个带参数的指令各生成 20 组确定性伪随机参数,用 Anchor 编码后由我们解码并逐字段比对。这是合成数据,不是链上验证;并用突变(改坏 option 标签、enum 下标)确认测试能失败。指令参数里没有有符号整数,有符号读取只由 `reader.test.ts` 覆盖。事件/账户解码与对账仍属 M3。

## D-011 M3 事件、zero_copy 账户与精确对账（离线实测，2026-10-12）

**数量更正**：任务文件写事件 24 条，但本地 `m1-run.json.events.length` 实际为 **25**。32 笔原始 RPC fixture 解出 25 条，与运行时 Anchor EventParser 的签名、名称、顺序、所有字段逐条一致。没有删除事件或修改 fixture；按完整实测样本验收。借贷/清算指令内的计息事件与业务事件可以共享顶层 `ixIndex`。

**布局与精度**：四类账户的结构体大小（不含 discriminator）分别为 Bank 1856、MarginfiAccount 2304、MarginfiGroup 1056、FeeState 256；加 8 后与七份 fixture 的 1864 / 2312 / 1064 / 264 字节逐个相等。`MarginfiAccount` 和 `FeeState` 的 zero_copy / repr(C) 已从本地 Rust 源码属性与 fixture 核实，补全 D-004。由 IDL 计算成员对齐、数组 stride 与尾部 padding，`WrappedI80F48` 明确按 `repr.align=8`（大小 16）。无字段枚举按 u8 与样本中的 Operational / SwitchboardPull / Collateral 值及后续字段对齐吻合；其他枚举值尚无真实账户样本。

七份解码结果（包括保留的 padding）与测试专用 `BorshCoder.accounts.decode` 的 PascalCase 名称、snake_case 字段逐项一致。账户长度不完全相等时返回 `decodeError`。金额位数为小端有符号 i128，48 位小数；精确十进制全程 bigint。账户入口只收到字节，**无法核对 owner**，未来 ingest/RPC 调用者必须检查 owner。

**精确不变量**：两个 bank 各自的三用户 `asset_shares` / `liability_shares` 原始位数和，与 bank 总 shares 完全相等（四个差均为 0）。四个 active 账户/bank 组合的存款、借款分子，与 Anchor snapshots 中 `depositNumerator` / `borrowNumerator` 完全相等，未约分分母均为 `2^96 = 79228162514264337593543950336`。对账同时报告全部 3 × 2 个用户/池子组合，关闭的 Bob tUSDC 位置也保留在事件流量中。

**事件 vs 状态**：以下数量均为 mint 原生单位；tUSDC 除以 `10^6`、tSOL 除以 `10^9` 才是代币数。整数事件累计与清算调整分列，差定义为 `状态 −（整数净流量 + 清算调整）`。表中的非整数小数显示截断到 18 位；代码与测试保留精确有理数，不用显示值判相等。

| 账户 / bank / 侧 | u64 事件净流量 | 清算调整（binary64 原值/推算） | 结束状态 | 差值 |
|---|---:|---:|---:|---:|
| Alice / tUSDC / 存 | 9000000000 | 0 | 9000001546.589030383738260787 | +1546.589030383738260787 |
| Bob / tUSDC / 借 | 474997824 | -475000000.000000953674316406 | 0 | +2176.000000953674316406 |
| Carol / tUSDC / 存 | 6000000000 | -487500000.000000978771008943 | 5512500348.538910809777205272 | +348.538911788548214216 |
| Bob / tSOL / 存 | 100000000000 | -10000000000 | 90000000000 | 0 |
| Carol / tSOL / 存 | 0 | +10000000000 | 10000000000 | 0 |
| Alice / tSOL / 存 | 0 | 0 | 0 | 0 |

其余侧（Alice/Carol 的借、Bob tUSDC 的存、三人的 tSOL 借）状态与净流量均为 0。三个非零差的精确分数为：

- Alice：`122533407042021320331036085304105 / 79228162514264337593543950336`。
- Bob：`2281701377 / 1048576`。
- Carol：`262333926684415432443825514641763 / 752667543885511207138667528192`。

解释与分类：

- **利息（方向与量级验证，精确分摊仍是推断）**：tUSDC 的最终 asset share value 为 `1.000000155398776513493430684320628643035888671875`，liability share value 为 `1.00000044510971264344334485940635204315185546875`。在本剧本从零建仓、share value 从 1 单调增加、没有破产/开仓费/Token-2022 转账费的条件下，每笔入账的利息不超过 `入账量 × 最终 share value 增幅`。Alice、Carol 存款上界分别为 1553.987765134934306843、932.392659080960584105；Bob 借款上界为 2225.548563217216724297。三个差均为正且在上界内，符合计息；测试另对差值精确分子与 1546–1547、348–349、2176–2177 的量级断言。反方向大差或超上界正差会返回 `issues`，不能无限用“利息”解释。
- **f64 精度**：清算前后 Bob 借款的 binary64 之差恰为 `475000000 + 2^-20`，不是精确整数 475000000。两次 f64 舍入的半 ULP 误差界相加为 `2^-20` 原生单位。Carol 支出按名义折扣 `0.975/0.95 = 39/38` 推算，f64 传播界为 `39/(38×1048576)`，约 0.000000978771 原生单位。原始 f64 先按 IEEE754 位模式转有理数，再做减法，避免二次浮点舍入。分类表示此误差来源存在，**不声称已经知道每次舍入的实际误差**。
- **其他已知机制与尚未精确分解部分**：本地 `marginfi_account.rs::repay_all` 对结束借款 `ceil`，多付的小于 1 原生单位进入保险费；因此关闭账户不应抹掉累计负净流量。Bob 差包含计息、这次取整及清算 f64 误差，不能把整个 2176 都称为精确利息。清算事件没有 Carol 的负债 bank 存款，39/38 推算仍有上游 I80F48 常数、运算截断与份额转换的不确定性；这部分没有逐位重演。当前 fixture 的三个非零差没有超方向/量级界的异常，但没有中间账户快照，**未证明三类贡献的精确分摊**。`reconcile` 面向本剧本的完整、从零开始、无 fee 的记录，不作为其他剧本通用会计证明。

**不要修 expected**：D-009 的“对账前改 expected 的 f64 残留”描述不成立。残留来自链上 `LiquidationBalances` 发出的 f64，以及事件未报告的清算人存款；本次没有修改 `scenario/expected.ts`。保留净流量/状态的差，才能说明“池子指标以账户状态为准、事件用于活动流”。

**验证边界**：所有验证只读本地 fixture/IDL/源码；调用栈中的 marginfi CPI、夹杂外部 Program data、失败/未知/截断日志仅合成测试，没有新增真实 CPI/失败/截断样本。fixture 未出现的事件、账户版本/枚举值、withdraw_all/破产/非零开仓费/Token-2022 费用尚未验证；没有逐笔复现利息及清算定点运算，也没有重跑剧本或查询最新链上状态。测试专用 Anchor 的 bigint 原生绑定不可用，使用其现有纯 JS 回退。

**突变实测**（每次临时改坏源文件，针对性测试退出 1，然后还原）：Bank `asset_share_value` 读取偏移 +8（4 项失败）；I80F48 先经 Number 再回 bigint（4 项失败）；移除失败交易事件屏蔽（1 项失败）；清算比例 39/38 改为 1（2 项失败）。保留损坏输入测试覆盖 shares 位翻转、缺 bank、坏 bool/enum、无法解码事件以及差值方向/量级异常；这些属于输入回归测试，与上述临时实现突变区分。

### D-011 审查补充(2026-10-12):利息守恒核对

codex 把三个非零差归为"利息"时,依据是方向与上界(推断)。审查时补了一个独立核对,用的是三个互不依赖的量:

| 量 | 来源 | 数值(tUSDC 原生单位) |
|---|---|---|
| 存款人所得(Alice + Carol 的差值) | 账户状态 − 事件净流量 | 1546.589 + 348.539 = 1895.128 |
| 协议费 + 保险费 | 程序发出的 7 条 AccrueInterest 事件里 `fees_collected` / `insurance_collected`(f64)之和 | 200.615 + 79.506 = 280.121 |
| 借款人多付(Bob 的差值) | 账户状态 − 事件净流量 | 2176.000 |

存款人所得 + 费用 = 2175.249,与借款人多付 2176.000 只差 **0.751 个原生单位**(< 1,与 `repay_all` 向上取整小于 1 的解释一致)。固化为 `reconcile.test.ts` 里的守恒测试。这比"方向与上界"强得多,但仍只覆盖 tUSDC 这一个 bank、这一次剧本;`AccrueInterest` 事件的 `delta` 是经过的**秒数**(7 次合计 59 秒),不是利息,别混用。

审查时另做三种突变,测试均失败后还原:事件不看调用栈(任何 `Program data` 都当 marginfi)、`toDecimal` 丢符号、`Reader.i128` 当无符号读。

可读性提醒:`reconcile.ts` 与 `event-balances.ts` 的单行很长、逻辑密,适合做测试与结论,不适合直接上屏讲解;EP5 视频里应讲 `layout.ts` / `fixed.ts` / `event.ts` 的片段,对账只展示结论表。


## D-012 M4 存储与 finalized 采集（2026-10-12）

**实现取舍**：沿用固定依赖 pg 8.23.1 / PGlite 0.5.8，不新增依赖或 ORM。Db 只有 query / transaction，迁移按 SQL 文件事务应用并记录 schema_migrations。raw_tx 是交易事实；原始 JSON 与失败 err 都保存。instructions 的顶层 inner_index 用 -1，避免 NULL 唯一性/主键问题；events 用日志位置唯一，类型/slot/账户表达式索引对应 EP7 查询。

**精度实测**：本机 PGlite 对小 int8 可返回 number、大 int8 返回 bigint（并非任务描述的一律 bigint）。适配按字段 OID=20 统一十进制字符串，null 保留；pg 默认字符串与 bigint 替身都覆盖。JSONB 金额是字符串，fromJson 按固定 IDL 恢复 bigint，pubkey/string/f64/原始 I80F48 字节不猜测、不误转。全部 25 事件/7 账户的数值类型往返逐字段验证，数据库读回的账户和事件交给 M3 reconcile 后 issues=[]；这仍保留 D-011 的机制差，未修改 expected。

**原子性和重建**：tail 每 slot 的原始写入与游标一起提交；decodePending 在一个事务里删除旧派生行、写指令/事件并更新 DECODER_VERSION（当前1）。rebuildDecoded 清空交易派生表、重置版本并完整重放；account_states 同时保留 raw_data base64，重建只更新解码字段而不删除原始快照。保留原始字节的额外字段是保证账户可离线重建的必要选择，不把纯解码 JSON 当唯一账户事实。

**RPC 与游标**：所有六个 RPC 方法都 finalized，getBlock/getTransaction 显式 json 与 maxSupportedTransactionVersion=0。顶层/inner 调用合并检查 v0 loadedAddresses。-32007 skipped 可推进空 slot；-32009 缺历史、null block/null transaction 必须报错，不能吞缺口。网络错误/429/5xx/短期节点不可用有有限指数退避与超时；错误里 URL 的 api-key 原文/编码值脱敏。backfill 只跳过已有下载，不以已知签名作为分页终点；失败交易仍保存。

**账户采样与 CLI**：owner 在解码前检查，不匹配拒绝当前批次。slot 用 getMultipleAccounts.context.slot；最多100个一批，不保证跨批同时采样。CLI 自动解码后只从成功交易提取协议角色地址，防止失败初始化的未创建/外国账户永久污染快照集合。成功后已关闭的历史账户报告缺失并跳过；直接 snapshotAccounts 默认仍拒绝缺失。旧快照保留但不代表当前存在性，没有关闭墓碑或逐笔历史状态。首次 tail 默认采当前 finalized slot；--from 含起点，有已有 blocks 游标则优先恢复；--once 处理本轮固定最新高度后退出。

**离线证据**：32交易重复入库/解码幂等，18指令/25事件按独立 steps/events 对照；清库重跑和派生重建逐行相等；旧版本行重做、新版行不变；slot写入中途/游标更新失败/解码中途抛错均回滚、重跑无缺漏。七账户owner/context.slot/原始字节重建以及CLI共用同步编排经PGlite与假RPC实测。另临时把 DECODER_VERSION 改为2，用旧行版本1运行升级测试成功后还原1，排除只会处理版本0的测试假设。

**突变实测**：去掉 ON CONFLICT、移除 slot 事务、同时去掉 events 全量与逐签名清理、去掉 owner 检查，四次针对性测试均退出1后还原。单独删 rebuild 的 events 全量清理仍通过，因为 pending 按所有签名等效清理；该等效突变不计为捕获，改坏两处后测试捕获。

**最终检查**：pnpm typecheck 退出0；pnpm test 退出0，85项通过、0失败、0跳过（M4新增28项）。现有依赖bigint原生绑定不可用，测试沿用纯JS回退，未重装依赖。

**没有验证**：没有联网、发送链上交易、重跑剧本或git提交。未启动Docker/Postgres，未运行真实pg迁移/CLI采集/reindex，未连接真实Helius或其他RPC；pg类型/连接事务行为仅由最小Pool替身验证，真实服务端OID/参数/时区与驱动集成仍待验证。CPI/v0/skipped/失败初始化/账户关闭/限流和fetch失败仅合成替身，不是新增链上样本；真实历史保留、长时tail、吞吐/限流压力、多worker迁移/重建并发均未验收。只信finalized、最大交易版本0，不处理链重组。当前账户快照可能领先于入库交易，不能据此证明逐笔历史会计对账；M3未精确分摊利息/f64/ceil的限制仍成立。

### D-012 真实环境验收(2026-10-12,docker Postgres 16 + Helius devnet)

codex 的 85 项离线测试全部通过，但只有连上真实 Postgres 和真实链才暴露了下面 **四个 PGlite 与 fixture 测不出的问题**，均已修复并各补了回归测试：

1. **`pg` 对无参数多语句 SQL 返回结果数组**(迁移文件)，适配层按单个结果处理而崩溃。PGlite 的 `exec` 语义不同，所以离线测试通过。
2. **成功交易的 `err` 被存成 JSONB `null`** 而不是 SQL `NULL`，`WHERE err IS NULL` 一笔都查不到。离线测试没人断言过这一列。
3. **devnet 区块里已有 v1 交易**(slot 509953364 的 70 笔里有 5 笔)，`getBlock` 用 `maxSupportedTransactionVersion: 0` 整块报错，indexer 会卡死在该 slot。改为支持到 1(`MAX_TX_VERSION`)；v1 的 JSON 形状与 v0 相同，只是 `addressTableLookups` 换成 `transactionConfig`。同时：形状不认识的交易，与程序无关就跳过，**提到该程序就报错**，不静默漏掉。
4. **`getBlock`(`rewards:false`)的 `meta.rewards` 是 `null`，`getTransaction` 的是 `[]`**。除此之外两条路径得到的交易逐字段相等。解码不读 rewards，所以结果相同，但 `raw_tx` 的 JSON 不是逐字节相同；同一签名先到先得(`ON CONFLICT DO NOTHING`)。

**实测结果**(devnet，剧本之后回填)：
- 签名回填：20 笔 `raw_tx` = 18 笔含 marginfi 指令 + 2 笔程序**部署/升级**交易(它们把程序地址作为账户引用，没有 marginfi 指令)；18 条指令、25 条事件，指令分布与独立基准一致；`err IS NULL` 20 笔。
- 从数据库读回事件与最新账户状态做 `reconcile`：`issues=[]`，两个 bank 的 shares 之和与总量逐位相等。
- **清库重跑一致**：`reindex` 前后 `instructions` md5 `2057a4eb…`、`events` md5 `d8a66517…` 相同；清库后改用「区块扫描 1 笔 + 签名回填其余」得到的 md5 同样相同。
- 区块扫描：只扫清算前后 5 个 slot，找到且只找到清算那一笔，游标推进到 509953366，内容与回填那条的 `slot`、`block_time`、`transaction`、`meta`(除 rewards)、`version` 全部相等；同一区间重跑 `inserted=0`。

**未验证 / 局限**：
- `tail` 逐 slot 调一次 `getBlock`，追赶历史很慢(devnet 约 2.5 slot/s，一天约 20 万次请求)；追赶请用 `--backfill`，`tail` 只适合从当前 finalized 起实时跟随或扫短区间。没有用 `getBlocks` 跳过空 slot。
- 没有长时间运行、并发、吞吐测试；没有测过 RPC 429 的真实退避。
- `account_states` 只保存"取快照那一刻的当前状态"，不是逐笔历史；每次运行都会新增一批行(按 `context.slot`)，没有清理策略。关闭账户没有墓碑。
- 只处理 finalized，不处理重组。
