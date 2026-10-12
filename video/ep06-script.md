# EP6 存储设计(目标 10–12 分钟)

**一句话结论**:先存原始、幂等入库、游标与数据同事务;清库重跑 md5 完全一致。

| 时间 | 画面 | 旁白要点 | 操作 |
|---|---|---|---|
| 0:00 | 三条原则 | 先存原始再解码;幂等;游标同事务 | |
| 1:30 | `002_decoded.sql` 片段 | 主键怎么选;为什么 `inner_index` 用 -1 不用 NULL | |
| 3:00 | `raw.ts` 片段 | `ON CONFLICT DO NOTHING` | |
| 4:00 | `tail.ts` 游标片段 | 同一个事务:写原始 + 推进游标;出错整体回滚 | |
| 5:30 | owner 检查片段 | 解码器只收字节;别人能造一个格式相同的账户 | |
| 6:30 | **真实环境验证** | 离线测试全过,真实 Postgres/Helius 又发现 4 个问题 | 讲 err 存成 JSONB null 这个 |
| 8:30 | **`verify-db`** | 回填 → 校验 → `reindex` → 再校验,md5 相同 | `pnpm exec tsx scripts/verify-db.ts` |
| 10:00 | 区块扫描 | 5 个 slot 找到且只找到清算那一笔;重跑 `inserted=0` | `ingest --tail --from S --to E` |
| 11:00 | 局限 | 不处理重组、状态只有快照、tail 追不动历史 | |
