# 进度

更新规则:每完成或阻塞一项就改这里,并写明日期。状态:`todo` / `doing` / `done` / `blocked`。

## 里程碑

| 里程碑 | 内容 | 对应章节 | 状态 | 备注 |
|---|---|---|---|---|
| M0 | 构建并部署 marginfi mrgn-0.1.0 到 devnet,完成一次 deposit + borrow | EP3 | done | 已部署并升级到 mock 价格版本(D-009);真实 Switchboard 因 devnet oracle 离线未启用(D-008) |
| M1 | 确定性剧本 + fixtures + expected.json | EP3 | doing | 2026-10-11：scenario 代码与离线检查已实现；devnet Switchboard 方案见 D-007。未运行 --execute、真实 Crossbar/feed/crank/改价、链上借贷清算、对账或重跑；未生成真实 fixtures |
| M2 | 指令解码器 | EP4 | done | 2026-10-12：手写 base58 / Reader / IDL Borsh、账户角色、顶层与 inner 指令及离线 CLI；32 笔 fixture 中的 18 条指令与 Anchor 一致；另有对全部 23 个带参数指令的 Anchor 编码往返测试(合成数据)；typecheck 通过，36 项测试通过。非空 v0 地址表与 marginfi CPI 仅合成测试，未联网或发送交易；fixture 之外的指令没有链上样本 |
| M3 | 事件 / inner instruction / 账户状态解码 | EP5 | todo | 账户为 zero_copy,按偏移解析 |
| M4 | 数据库与幂等入库、回填、游标 | EP6 | todo | |
| M5 | API + 前端(含 X 光面板) | EP7 | todo | |
| M6 | 按章节整理提交历史、打 tag、写 docs 与 video 分镜 | 全部 | todo | |

## 已完成

- 2026-10-11:创建仓库骨架(AGENTS.md、docs、目录占位、docker-compose、001_raw_tx.sql)。

- 2026-10-11:`program/build.sh` 构建 marginfi 与 mocks 成功(带自有 program id 补丁)。

- 2026-10-11：实现 M1 固定步骤、默认离线计划、确定性账户、Switchboard v1 路径、Anchor 事件记录、expected 净流量与结束快照代码；离线检查覆盖公钥、计划入口、事件累加、真实 IDL 指令、EventParser 和 SDK 指令边界。未安装依赖、未提交 git、未发送交易。余额精度与计息限制见 D-009；链上验收尚未运行。

- 2026-10-11：最终 `pnpm typecheck` 退出码 0；`pnpm test` 14 项通过、0 失败、0 跳过。RPC / Crossbar 调用在相关测试中均由离线替身处理。bigint 原生绑定不可用，测试使用依赖自带的纯 JavaScript 回退，没有重装或重建依赖。

- 2026-10-11:M0、M1 完成。marginfi 与 mocks 已部署到 devnet;12 步剧本一次跑通,32 笔交易 finalized,五类借贷指令全覆盖。

## 下一步

1. M3：事件与账户状态解码；先处理 D-009 提到的清算数量精度残留，再做余额对账。
2. 验证新 `--run-id` 重跑得到结构一致的结果。
3. 监控 Switchboard devnet oracle,恢复后评估切回。

## M2 离线验收（2026-10-12）

- 新增任务指定的 8 个实现文件与对应离线测试；不新增依赖。README、模块清单及 EP4 代码片段引用已同步。
- `pnpm typecheck` 退出码 0；`pnpm test` 36 项通过、0 失败、0 跳过。测试专用 Anchor 及现有剧本测试的依赖提示 bigint 原生绑定不可用，使用纯 JavaScript 回退；未重建依赖。
- CLI 通过 `node --import tsx` 验证成功/缺参数/未知签名与任意当前目录；`pnpm exec node --import tsx scripts/decode-tx.ts <签名>` 实际运行成功。直接 `pnpm exec tsx ...` 因沙箱禁止本地 IPC 管道而在脚本执行前报 `listen EPERM`，该启动方式未验证成功。32 笔 fixture 的 18 条 marginfi 指令（11 类）与 Anchor 参数对照通过；全部步骤金标准、借款与清算账户角色/remaining 顺序通过。
- 没有联网、运行 `fetch-fixtures.ts` / `--execute`、部署、发送链上交易、启动数据库或提交 git。没有实现/验收 M3 的事件/账户解码或余额对账。
- 尚待真实样本验证：非空 v0 地址表、marginfi CPI，以及 fixture 未出现的 25 类指令参数。string / bytes / vec / 元组 / 有符号整数等通过合成测试，不把这些结果视为新增链上验证。
