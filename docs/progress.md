# 进度

更新规则:每完成或阻塞一项就改这里,并写明日期。状态:`todo` / `doing` / `done` / `blocked`。

## 里程碑

| 里程碑 | 内容 | 对应章节 | 状态 | 备注 |
|---|---|---|---|---|
| M0 | 构建并部署 marginfi mrgn-0.1.0 到 devnet,完成一次 deposit + borrow | EP3 | done | 已部署并升级到 mock 价格版本(D-009);真实 Switchboard 因 devnet oracle 离线未启用(D-008) |
| M1 | 确定性剧本 + fixtures + expected.json | EP3 | doing | 2026-10-11：scenario 代码与离线检查已实现；devnet Switchboard 方案见 D-007。未运行 --execute、真实 Crossbar/feed/crank/改价、链上借贷清算、对账或重跑；未生成真实 fixtures |
| M2 | 指令解码器 | EP4 | done | 2026-10-12：手写 base58 / Reader / IDL Borsh、账户角色、顶层与 inner 指令及离线 CLI；32 笔 fixture 中的 18 条指令与 Anchor 一致；另有对全部 23 个带参数指令的 Anchor 编码往返测试(合成数据)；typecheck 通过，36 项测试通过。非空 v0 地址表与 marginfi CPI 仅合成测试，未联网或发送交易；fixture 之外的指令没有链上样本 |
| M3 | 事件 / inner instruction / 账户状态解码 | EP5 | done | 2026-10-12：离线日志栈、IDL C 布局、I80F48 与账户解码、精确对账及两个 CLI；32 笔/25 事件、7 账户与 Anchor 对照通过；四种实现突变捕获并还原。差值实测及归因限制见 D-011；未联网、发送交易或提交 git |
| M4 | 数据库与幂等入库、回填、游标 | EP6 | done | 离线 89 项测试 + 真实 Postgres/Helius devnet 验收(D-012):清库重跑 md5 一致、读回对账 issues=[]；真实环境另发现并修复 4 个问题 |
| M5 | API + 前端(含 X 光面板) | EP7 | todo | |
| M6 | 按章节整理提交历史、打 tag、写 docs 与 video 分镜 | 全部 | todo | |

## 已完成

- 2026-10-11:创建仓库骨架(AGENTS.md、docs、目录占位、docker-compose、001_raw_tx.sql)。

- 2026-10-11:`program/build.sh` 构建 marginfi 与 mocks 成功(带自有 program id 补丁)。

- 2026-10-11：实现 M1 固定步骤、默认离线计划、确定性账户、Switchboard v1 路径、Anchor 事件记录、expected 净流量与结束快照代码；离线检查覆盖公钥、计划入口、事件累加、真实 IDL 指令、EventParser 和 SDK 指令边界。未安装依赖、未提交 git、未发送交易。余额精度与计息限制见 D-009；链上验收尚未运行。

- 2026-10-11：最终 `pnpm typecheck` 退出码 0；`pnpm test` 14 项通过、0 失败、0 跳过。RPC / Crossbar 调用在相关测试中均由离线替身处理。bigint 原生绑定不可用，测试使用依赖自带的纯 JavaScript 回退，没有重装或重建依赖。

- 2026-10-11:M0、M1 完成。marginfi 与 mocks 已部署到 devnet;12 步剧本一次跑通,32 笔交易 finalized,五类借贷指令全覆盖。

- 2026-10-12:M4 完成并在真实 Postgres + Helius devnet 上验收(D-012)：离线测试之外另发现并修复 4 个只有真实环境才暴露的问题。

## 下一步

1. M5：基于 M4 的派生表实现只读 API/前端；真实 Postgres 与 RPC 集成仍待验证。M3 保留 f64 差值，未修改 expected。
2. 验证新 `--run-id` 重跑得到结构一致的结果。
3. 监控 Switchboard devnet oracle,恢复后评估切回。

## M2 离线验收（2026-10-12）

- 新增任务指定的 8 个实现文件与对应离线测试；不新增依赖。README、模块清单及 EP4 代码片段引用已同步。
- `pnpm typecheck` 退出码 0；`pnpm test` 36 项通过、0 失败、0 跳过。测试专用 Anchor 及现有剧本测试的依赖提示 bigint 原生绑定不可用，使用纯 JavaScript 回退；未重建依赖。
- CLI 通过 `node --import tsx` 验证成功/缺参数/未知签名与任意当前目录；`pnpm exec node --import tsx scripts/decode-tx.ts <签名>` 实际运行成功。直接 `pnpm exec tsx ...` 因沙箱禁止本地 IPC 管道而在脚本执行前报 `listen EPERM`，该启动方式未验证成功。32 笔 fixture 的 18 条 marginfi 指令（11 类）与 Anchor 参数对照通过；全部步骤金标准、借款与清算账户角色/remaining 顺序通过。
- 没有联网、运行 `fetch-fixtures.ts` / `--execute`、部署、发送链上交易、启动数据库或提交 git。没有实现/验收 M3 的事件/账户解码或余额对账。
- 尚待真实样本验证：非空 v0 地址表、marginfi CPI，以及 fixture 未出现的 25 类指令参数。string / bytes / vec / 元组 / 有符号整数等通过合成测试，不把这些结果视为新增链上验证。


## M3 离线验收（2026-10-12）

- 实现事件调用栈（顶层下标/CPI 归属）、未知/失败/截断处理，Borsh f32/f64、IDL repr(C) 布局、四类账户严格长度解码、精确定点数及有理数对账。新增两个离线 CLI；README、模块清单、EP5 与 D-011 已同步；不新增依赖、不改 `scenario/expected.ts`。
- 任务描述 24 事件与实际 fixture 25 不一致；以完整 fixture 验证全部 25 条，不删除事件。七份账户所有字段与 Anchor 对照；两个 bank shares 四个逐位不变量及四个 active 组合的数量分子与 Anchor snapshot 完全一致。全部六个用户/池子组合保留流量差，非零差的精确分子、方向与量级有固定断言。
- 最终 `pnpm typecheck` 退出码 0；`pnpm test` 57 项通过、0 失败、0 跳过（退出码 0）。测试依赖的 bigint 原生绑定不可用，使用已有纯 JavaScript 回退，未安装或重建依赖。
- 临时实现突变：Bank asset_share_value 偏移 +8（4 项失败）、I80F48 经 Number（4 项失败）、移除失败交易屏蔽（1 项失败）、清算 39/38 比例改为 1（2 项失败）；针对性测试均退出 1，随后逐项还原。
- 实际运行两个 `pnpm exec node --import tsx` CLI 成功；子进程测试覆盖任意当前目录、缺参数、多参数、未知地址/类型。只读本地 fixtures，未使用直接 tsx 启动方式。
- 未联网、查询 RPC、运行 fetch-* / --execute、重跑剧本、构建/部署程序、发送交易、启动数据库或提交 git。失败/CPI/截断仅合成日志；其他事件/账户版本/枚举值、withdraw_all/破产/非零开仓费/Token-2022 费用未用真实样本验证。
- 不确定性：利息归因符合正向与上界，但没有中间账户快照，未精确拆出每笔利息/ceil/f64/定点截断的贡献；Carol 清算支出仍按名义 39/38 推算，没有逐位重演上游定点运算。精确验收对象是结束状态与 shares，不把事件净流量当真实余额。


## M4 离线验收（2026-10-12）

- 最终 `pnpm typecheck` 退出0；`pnpm test` 退出0，85项通过、0失败、0跳过；新增M4 28项。现有测试依赖提示bigint原生绑定不可用，沿用纯JavaScript回退，未安装或重建依赖。

- 已完整阅读指定文档、EP6和现有core/decoder/store。实现薄Db适配、事务SQL runner/002表、bigint JSON往返、签名幂等raw、版本解码/重建、owner/current-slot快照与原始字节保留、手写finalized RPC/重试脱敏、getBlock规范化、签名分页回填、slot事务游标、三个CLI及pnpm入口。README、各模块清单、EP6、D-012已同步；不新增依赖、不改版本。
- PGlite实测：32raw重复写入仍32；18instructions/25events与独立steps/events对照；重复解码、清库重跑、全量重建逐行相等；旧版本删除obsolete行且当前行不变；7账户数据库读回后的reconcile.issues=[]。slot中途/游标/解码事务错误均回滚并恢复。CLI共用syncStored实测自动解码与快照，排除失败初始化、报告关闭账户。
- pg仅用Pool最小替身测试bigint/字符串/OID和固定client的BEGIN/COMMIT/ROLLBACK/release。本机PGlite小BIGINT返回number、大值返回bigint，Db按OID统一字符串，含null断言。JSON按IDL恢复整数，25事件/7账户精确类型往返。
- 四种临时破坏突变均捕获：去掉ON CONFLICT、移除slot事务、同时漏清events全量和逐签名两处、去掉owner检查；各针对性测试退出1（1项失败）后还原。单独删全量events清理测试仍通过，因逐签名清理等效，此突变不计捕获。另临时DECODER_VERSION=2/旧行=1升级测试退出0，还原版本1。
- 未联网、调用真实RPC/Helius、运行剧本/部署/发送交易、启动Docker/Postgres或提交git。真实pg迁移、真实CLI正常采集/reindex、RPC重试/跳slot行为、历史保留、长时tail、并发/吞吐均未验收。CLI子进程只运行帮助和非法参数；正常编排由PGlite/假RPC执行。
- 不确定性：真实服务端/驱动集成仍待验证；当前账户快照不能冒充逐笔历史，关闭账户无墓碑，旧快照不证明当前存在。M3的利息/f64/ceil分摊未被M4消除。
