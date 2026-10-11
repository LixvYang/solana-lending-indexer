# 进度

更新规则:每完成或阻塞一项就改这里,并写明日期。状态:`todo` / `doing` / `done` / `blocked`。

## 里程碑

| 里程碑 | 内容 | 对应章节 | 状态 | 备注 |
|---|---|---|---|---|
| M0 | 构建并部署 marginfi mrgn-0.1.0 到 devnet,完成一次 deposit + borrow | EP3 | done | 已部署并升级到 mock 价格版本(D-009);真实 Switchboard 因 devnet oracle 离线未启用(D-008) |
| M1 | 确定性剧本 + fixtures + expected.json | EP3 | doing | 2026-10-11：scenario 代码与离线检查已实现；devnet Switchboard 方案见 D-007。未运行 --execute、真实 Crossbar/feed/crank/改价、链上借贷清算、对账或重跑；未生成真实 fixtures |
| M2 | 指令解码器 | EP4 | todo | |
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

1. M2:指令解码器(`src/decoder/instruction.ts`),用 `fixtures/m1-run.json` 离线测试。可委派 codex。
2. 验证新 `--run-id` 重跑得到结构一致的结果。
3. 监控 Switchboard devnet oracle,恢复后评估切回。
