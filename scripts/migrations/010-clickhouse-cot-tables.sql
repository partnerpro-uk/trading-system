-- COT (Commitments of Traders) Positions from CFTC
-- Stores weekly institutional positioning data for currency futures
-- Source: CFTC Traders in Financial Futures (TFF) report

CREATE TABLE IF NOT EXISTS cot_positions (
  report_date Date,
  pair LowCardinality(String),
  cme_contract LowCardinality(String),

  -- Open interest
  open_interest UInt32,

  -- Net positions (long - short) per category
  dealer_net_positions Int32,
  asset_mgr_net_positions Int32,
  lev_money_net_positions Int32,
  other_rpt_net_positions Int32,
  nonrpt_net_positions Int32,

  -- Raw long/short for detail views
  dealer_long UInt32,
  dealer_short UInt32,
  asset_mgr_long UInt32,
  asset_mgr_short UInt32,
  lev_money_long UInt32,
  lev_money_short UInt32,
  other_rpt_long UInt32,
  other_rpt_short UInt32,
  nonrpt_long UInt32,
  nonrpt_short UInt32,

  -- Pre-calculated analytics
  weekly_change_lev_money Int32 DEFAULT 0,
  weekly_change_asset_mgr Int32 DEFAULT 0,

  created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYear(report_date)
ORDER BY (pair, report_date);
