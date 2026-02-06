-- COT (Commitments of Traders) Positions from CFTC
-- Recent 52 weeks of institutional positioning for UI display
-- Source: CFTC Traders in Financial Futures (TFF) report

CREATE TABLE IF NOT EXISTS cot_positions (
  report_date DATE NOT NULL,
  pair VARCHAR(10) NOT NULL,
  cme_contract VARCHAR(50) NOT NULL,

  open_interest INTEGER NOT NULL,

  dealer_net_positions INTEGER NOT NULL,
  asset_mgr_net_positions INTEGER NOT NULL,
  lev_money_net_positions INTEGER NOT NULL,
  other_rpt_net_positions INTEGER NOT NULL,
  nonrpt_net_positions INTEGER NOT NULL,

  dealer_long INTEGER NOT NULL,
  dealer_short INTEGER NOT NULL,
  asset_mgr_long INTEGER NOT NULL,
  asset_mgr_short INTEGER NOT NULL,
  lev_money_long INTEGER NOT NULL,
  lev_money_short INTEGER NOT NULL,
  other_rpt_long INTEGER NOT NULL,
  other_rpt_short INTEGER NOT NULL,
  nonrpt_long INTEGER NOT NULL,
  nonrpt_short INTEGER NOT NULL,

  weekly_change_lev_money INTEGER DEFAULT 0,
  weekly_change_asset_mgr INTEGER DEFAULT 0,

  lev_money_percentile SMALLINT DEFAULT 50,
  asset_mgr_percentile SMALLINT DEFAULT 50,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (report_date, pair)
);

CREATE INDEX IF NOT EXISTS idx_cot_pair ON cot_positions (pair, report_date DESC);
