-- EP6:原始交易是唯一事实来源,其余表都可由它重放得到。
CREATE TABLE raw_tx (
  signature   TEXT PRIMARY KEY,
  slot        BIGINT NOT NULL,
  block_time  TIMESTAMPTZ,
  err         JSONB,            -- 失败交易也保留,null 表示成功
  tx          JSONB NOT NULL    -- getBlock 返回的完整交易(含 meta)
);

CREATE INDEX raw_tx_slot_idx ON raw_tx (slot);

-- ingest 游标:已处理到的最高 finalized slot
CREATE TABLE ingest_cursor (
  name  TEXT PRIMARY KEY,
  slot  BIGINT NOT NULL
);
