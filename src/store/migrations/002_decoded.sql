-- INPUT: 001 原始表。OUTPUT: 可重建的解码表。POSITION: EP6 schema。SYNC: 同步 folder.md。
-- #region ep6-schema
ALTER TABLE raw_tx ADD COLUMN decoded_version INT;

-- signature + 顶层位置 + CPI 位置确定一次指令调用。
-- 顶层用 -1：NULL 的普通唯一性比较不相等，且 PRIMARY KEY 禁止 NULL。
CREATE TABLE instructions (
  signature TEXT NOT NULL REFERENCES raw_tx(signature) ON DELETE CASCADE,
  ix_index INT NOT NULL, inner_index INT NOT NULL DEFAULT -1,
  slot BIGINT NOT NULL, block_time TIMESTAMPTZ, stack_height INT,
  name TEXT NOT NULL, args JSONB NOT NULL, accounts JSONB NOT NULL,
  remaining JSONB NOT NULL, decode_error TEXT,
  PRIMARY KEY (signature, ix_index, inner_index)
);

-- 同一交易日志里的位置唯一；同一顶层指令可以 emit 多个事件。
CREATE TABLE events (
  signature TEXT NOT NULL REFERENCES raw_tx(signature) ON DELETE CASCADE,
  log_index INT NOT NULL, ix_index INT NOT NULL, slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ, name TEXT NOT NULL, data JSONB NOT NULL,
  truncated BOOL NOT NULL,
  PRIMARY KEY (signature, log_index)
);
-- 同一地址同一 context.slot 是一次快照；原始字节存在 data 的 raw_data，支持再解码。
CREATE TABLE account_states (
  address TEXT NOT NULL, slot BIGINT NOT NULL, type TEXT NOT NULL,
  owner TEXT NOT NULL, lamports BIGINT NOT NULL, data JSONB NOT NULL,
  PRIMARY KEY (address, slot)
);
-- #endregion
-- EP7 活动流按指令/事件类型筛选。
CREATE INDEX instructions_name_idx ON instructions(name);
CREATE INDEX events_name_idx ON events(name);
-- EP7 活动流按 finalized slot 排序或筛选。
CREATE INDEX events_slot_idx ON events(slot);
-- EP7 查看某个 marginfi 账户的历史活动。
CREATE INDEX events_account_idx ON events((data->'header'->>'marginfi_account'));
