CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  starting_cash NUMERIC(12, 2) NOT NULL DEFAULT 1000,
  cash_balance NUMERIC(12, 2) NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  wealth_tier INTEGER NOT NULL DEFAULT 1,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE cards (
  id UUID PRIMARY KEY,
  creator_user_id UUID REFERENCES users(id),
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  supply_type TEXT NOT NULL CHECK (supply_type IN ('limited', 'unlimited')),
  total_supply INTEGER NOT NULL,
  creator_share_percent NUMERIC(5, 2) NOT NULL,
  base_price NUMERIC(12, 2) NOT NULL,
  current_price NUMERIC(12, 2) NOT NULL,
  volatility NUMERIC(8, 4) NOT NULL,
  liquidity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  anti_whale_multiplier NUMERIC(8, 4) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE holdings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  average_cost NUMERIC(12, 2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, card_id)
);

CREATE TABLE trades (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity INTEGER NOT NULL,
  price_per_unit NUMERIC(12, 2) NOT NULL,
  fee_paid NUMERIC(12, 2) NOT NULL,
  slippage_paid NUMERIC(12, 2) NOT NULL,
  total_value NUMERIC(12, 2) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  market_tick BIGINT NOT NULL
);

CREATE TABLE market_ticks (
  id UUID PRIMARY KEY,
  tick_number BIGINT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  global_index NUMERIC(12, 4) NOT NULL DEFAULT 1000,
  event_id UUID
);

CREATE TABLE events (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  effect_value NUMERIC(8, 4) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE news_items (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL,
  related_event_id UUID REFERENCES events(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leaderboard_snapshots (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  net_worth NUMERIC(12, 2) NOT NULL,
  rank_position INTEGER NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
