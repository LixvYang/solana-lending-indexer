# .agents

代理共用配置目录。

- `skills/<name>/SKILL.md`:项目专用 skills。需要 Solana 开发相关 skill 时,放到这里即可(例如 Anchor、Solana 交易/账户解析、Helius 使用说明)。
- `.claude/skills` 是指向 `.agents/skills` 的软链接,不要在 `.claude/skills` 里直接放文件。

添加 skill 的建议:先用 `find-skills` 搜索现成的,安装后检查其内容再提交,不要提交含密钥或个人路径的 skill。
