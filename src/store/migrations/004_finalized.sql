-- 乐观入库:跟随模式下交易在 confirmed 时就先入库(页面几秒内能看到),
-- 之后由"终局确认清扫"改成 true;如果它所在的分叉被丢弃,清扫会把它连同解码出的行一起删掉。
-- 已有的行都是按 finalized 入库的,所以默认值是 TRUE。
ALTER TABLE raw_tx ADD COLUMN finalized BOOLEAN NOT NULL DEFAULT TRUE;

-- 清扫只关心还没终局的少数几行,用部分索引,不拖慢正常查询。
CREATE INDEX raw_tx_unfinalized_idx ON raw_tx (slot) WHERE NOT finalized;
