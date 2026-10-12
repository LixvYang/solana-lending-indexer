/**
 * API 与前端之间的数据契约(JSON)。后端实现与前端都以这个文件为准，改动要同时改两边。
 *
 * 约定:
 * - `native` 结尾或说明为"原生单位"的数量是十进制字符串(mint 的最小单位，向下取整)，因为 u64 会超出 JS 安全整数。
 * - `*_usd`、`*_apr`、`price`、`utilization`、`health` 是给人看的 number(浮点)，不能用来对账；
 *   需要精确值的地方另给字符串字段。
 * - 时间一律 ISO 8601 字符串；slot 是十进制字符串。
 */

export interface BankWeights {
  asset_init: number;
  asset_maint: number;
  liability_init: number;
  liability_maint: number;
}

/** 分段线性利率曲线的参数(上游 InterestRateConfig)。 */
export interface InterestCurve {
  optimal_utilization: number;
  plateau_rate: number;
  max_rate: number;
  /** 借款人在基础利率之上多付的费用：按比例的部分与固定 APR 的部分。 */
  fee_rate: number;
  fee_fixed_apr: number;
}

export interface BankView {
  address: string;
  mint: string;
  /** 链下标签(链上没有代币符号)，没有则回退为地址缩写。 */
  label: string;
  decimals: number;
  /** 来自预言机账户；没有快照时为 null。 */
  price: number | null;
  price_updated_at: string | null;
  oracle_feed: string | null;
  total_deposits: string;
  total_borrows: string;
  total_deposits_usd: number | null;
  total_borrows_usd: number | null;
  /** 借款 / 存款，0..1。 */
  utilization: number;
  lending_apr: number;
  borrowing_apr: number;
  weights: BankWeights;
  curve: InterestCurve;
  /** I80F48 精确十进制字符串。 */
  asset_share_value: string;
  liability_share_value: string;
  last_accrual_at: string;
}

export interface PoolView {
  program: string;
  group: string | null;
  /** 这些账户状态快照的 slot(取自 account_states.slot 的最大值)。 */
  as_of_slot: string | null;
  banks: BankView[];
  totals: { deposits_usd: number | null; borrows_usd: number | null; utilization: number | null };
}

export interface RatePoint {
  utilization: number;
  lending_apr: number;
  borrowing_apr: number;
}

export interface RateCurveView {
  bank: string;
  label: string;
  points: RatePoint[];
  current: RatePoint;
}

export interface BalanceView {
  bank: string;
  label: string;
  /** 原生单位 = shares × share_value，向下取整。 */
  deposit: string;
  borrow: string;
  deposit_usd: number | null;
  borrow_usd: number | null;
}

export type AccountStatus = 'no_debt' | 'healthy' | 'liquidatable';

export interface AccountView {
  address: string;
  label: string;
  authority: string;
  balances: BalanceView[];
  /**
   * 健康度 = Σ(存款 × 价格 × 资产权重) − Σ(借款 × 价格 × 负债权重)，单位 USD。
   * init 用开仓权重，maint 用维持权重；maint < 0 即可被清算。
   * 与清算事件里程序自己报告的 liquidatee_pre_health 逐位对得上(见 src/api 测试)。
   */
  health: { init: number | null; maint: number | null; assets_usd: number | null; liabilities_usd: number | null };
  status: AccountStatus;
}

export interface ActivityItem {
  signature: string;
  slot: string;
  block_time: string | null;
  /** 顶层指令下标；事件所属指令。 */
  ix_index: number;
  /** 指令名，如 lending_account_borrow。 */
  instruction: string;
  /** 与该指令对应的主事件名(若有)，如 LendingAccountBorrowEvent。 */
  event: string | null;
  account: string | null;
  account_label: string | null;
  bank: string | null;
  bank_label: string | null;
  /** 原生单位；清算等用 f64 的事件为 null。 */
  amount: string | null;
  ok: boolean;
}

export interface ActivityPage {
  items: ActivityItem[];
  /** 下一页的游标(传回 before)；没有更多则为 null。 */
  next_before: string | null;
}

/** 交易里的一段字节：偏移、长度、含义、十六进制与解出的值。教学用。 */
export interface ByteSpan {
  offset: number;
  length: number;
  label: string;
  hex: string;
  value: unknown;
}

export interface XrayInstruction {
  ix_index: number;
  inner_index: number | null;
  program: string;
  name: string;
  /** 指令数据的 base58 原文(RPC 返回的就是它)与十六进制。 */
  data_base58: string;
  data_hex: string;
  /** discriminator + 各参数的字节切分。 */
  spans: ByteSpan[];
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  remaining: string[];
  decode_error: string | null;
}

export interface XrayEvent {
  log_index: number;
  ix_index: number;
  name: string;
  /** 日志里 `Program data:` 的 base64 原文。 */
  base64: string;
  data: Record<string, unknown>;
}

/**
 * "X 光"：同一笔交易的三种形态——链上原始字节、解码结果、写进数据库的行。
 * 这是整个合集的核心演示。
 */
export interface XrayView {
  signature: string;
  slot: string;
  block_time: string | null;
  err: unknown | null;
  logs: string[];
  instructions: XrayInstruction[];
  events: XrayEvent[];
  /** 数据库里 instructions / events 表的行(JSON 原样)。 */
  rows: { instructions: Record<string, unknown>[]; events: Record<string, unknown>[] };
}
