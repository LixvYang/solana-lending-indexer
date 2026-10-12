# EP4 解析指令(目标 12–15 分钟)

**一句话结论**:指令数据 = 8 字节身份证 + Borsh 参数;账户的角色靠 IDL 的位置命名。

| 时间 | 画面 | 旁白要点 | 操作 |
|---|---|---|---|
| 0:00 | 一笔交易的 base58 data | 我们要把这串字符还原成"谁调用了什么" | |
| 1:30 | discriminator 片段 | `sha256("global:<入口名>")` 前 8 字节;36 个入口全部一致 | 运行 discriminator 测试 |
| 3:30 | Borsh 规则表 | 整数小端;option 的 0/1 标签;vec/string 的 4 字节长度;enum 下标 | |
| 5:00 | `reader.ts` 片段 | 整个解码器的地基:只会"往后读 N 字节" | |
| 6:30 | `borsh.ts` 片段 | 让 IDL 驱动:遇到什么类型读什么 | |
| 8:30 | 账户角色 | 下标 → 名字;`remaining` 是什么 | |
| 9:30 | `transaction.ts` 片段 | 顶层 + inner;v0 账户表拼接顺序 | |
| 11:00 | **跑 CLI** | 看输出:`amount: "5000000000"`、账户映射 | `pnpm exec tsx scripts/decode-tx.ts <签名>` |
| 12:00 | 验证方法 | 对照 Anchor、往返测试、突变验证 | 现场把 option 标签取反,看测试失败 |
| 14:00 | 常见坑 | unknown 不丢、innerIndex、别虚构计息指令 | |
