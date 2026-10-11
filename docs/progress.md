# 进度

更新规则:每完成或阻塞一项就改这里,并写明日期。状态:`todo` / `doing` / `done` / `blocked`。

## 里程碑

| 里程碑 | 内容 | 对应章节 | 状态 | 备注 |
|---|---|---|---|---|
| M0 | 构建并部署 marginfi mrgn-0.1.0 到 devnet,完成一次 deposit + borrow | EP3 | doing | 构建已通过(D-002);待部署与 Switchboard 价格(D-007) |
| M1 | 确定性剧本 + fixtures + expected.json | EP3 | todo | 依赖 M0;mock 价格方案见 D-003 |
| M2 | 指令解码器 | EP4 | todo | |
| M3 | 事件 / inner instruction / 账户状态解码 | EP5 | todo | 账户为 zero_copy,按偏移解析 |
| M4 | 数据库与幂等入库、回填、游标 | EP6 | todo | |
| M5 | API + 前端(含 X 光面板) | EP7 | todo | |
| M6 | 按章节整理提交历史、打 tag、写 docs 与 video 分镜 | 全部 | todo | |

## 已完成

- 2026-10-11:创建仓库骨架(AGENTS.md、docs、目录占位、docker-compose、001_raw_tx.sql)。

- 2026-10-11:`program/build.sh` 构建 marginfi 与 mocks 成功(带自有 program id 补丁)。

## 下一步

1. M0:部署到 devnet;验证 Switchboard 自建 feed 的可行性(D-007)。
2. 写代码任务可委派给 codex(已安装 codex-cli 0.162.1)。
