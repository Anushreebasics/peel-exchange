export type SupplyMode = 'limited' | 'unlimited';

export type CardDefinition = {
  id: string;
  name: string;
  symbol: string;
  category: string;
  basePrice: number;
  volatility: number;
  demandBias: number;
  creatorShare: number;
  supplyMode: SupplyMode;
  supply: number;
  owned: number;
  momentum: number;          // Short-term price spike ±0.5, decays each tick
  priceHistory: number[];    // Last 14 tick prices (client-derived)
  publishedByPlayer?: boolean;
  publisherId?: string;
};

export type NewsItem = {
  id: string;
  title: string;
  body: string;
  mood: 'positive' | 'neutral' | 'negative';
  impact: string;
  cardSymbol?: string;
  priceDelta?: number;
};

export type LeaderboardEntry = {
  name: string;
  netWorth: number;
  streak: number;
  rank?: number;
};

export type PlayerState = {
  cash: number;
  xp: number;
  level: number;
  holdings: Record<string, number>;
  avgCost: Record<string, number>;       // Average cost basis per card
  creatorWallet: number;
  lastDailyRewardAt: number | null;
  lastLoginDate: string | null;          // ISO date string YYYY-MM-DD
  loginStreak: number;
  lastTickAt: number;
  rumors?: string[];
};

export type MarketState = {
  day: number;
  tick: number;
  cards: CardDefinition[];
  news: NewsItem[];
  leaderboard: LeaderboardEntry[];
};

export type GameState = {
  player: PlayerState;
  market: MarketState;
  log: string[];
};

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'yellow-ledger-save-v1';
const DAILY_REWARD_MS = 24 * 60 * 60 * 1000;
const PRICE_FLOOR_FACTOR = 0.4;
const PRICE_CAP_FACTOR = 4;
const BASE_FEE_RATE = 0.02;
const BASE_SLIPPAGE_RATE = 0.025;
const MAX_PRICE_HISTORY = 14;

// ── Utilities ──────────────────────────────────────────────────────────────
function seededRandom(seed: number): number {
  const value = Math.sin(seed * 9301.0 + 49297.0) * 233280.0;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function hashString(input: string) {
  return input.split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Price Formula ──────────────────────────────────────────────────────────
// 4-factor model: demandWave + trend + seasonality + momentum + scarcity
export function getMarketPrice(card: CardDefinition, tick = 0, day = 1): number {
  const demandWave = Math.sin((tick + 1) / 4 + day / 3) * card.volatility;
  const trend = clamp(card.demandBias * day * 0.6, -0.3, 0.5);
  const seasonality = Math.cos((day + hashString(card.id)) / 5) * 0.04;
  const momentumEffect = clamp(card.momentum ?? 0, -0.45, 0.45);

  // Scarcity pressure for limited cards — fully sold out adds +35% to base
  let scarcityBonus = 0;
  if (card.supplyMode === 'limited' && card.supply > 0) {
    const soldRatio = card.owned / card.supply;
    scarcityBonus = soldRatio * 0.35;
  }

  const rawPrice = card.basePrice * (1 + demandWave + trend + seasonality + momentumEffect + scarcityBonus);
  const floor = card.basePrice * PRICE_FLOOR_FACTOR;
  const cap = card.basePrice * PRICE_CAP_FACTOR;
  return Math.round(clamp(rawPrice, floor, cap));
}

// ── Cost Calculations ──────────────────────────────────────────────────────
// Anti-whale slippage: scales with the fraction of total outstanding supply the player holds
function whaleFactor(state: GameState, cardId: string, additionalQty: number): number {
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card || card.owned <= 0) return 0;
  const playerHolds = getHoldingCount(state, cardId);
  const totalCirculating = Math.max(1, card.owned);
  return clamp((playerHolds + additionalQty) / totalCirculating, 0, 1);
}

export function getBuyCost(state: GameState, cardId: string, quantity: number): number {
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card || quantity <= 0) return 0;
  const price = getMarketPrice(card, state.market.tick, state.market.day);
  const whale = whaleFactor(state, cardId, quantity);
  const slippage = 1 + BASE_SLIPPAGE_RATE * quantity * (1 + 3 * whale);
  return Math.round(price * (1 + BASE_FEE_RATE) * slippage * quantity);
}

export function getSellProceeds(state: GameState, cardId: string, quantity: number): number {
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card || quantity <= 0) return 0;
  const price = getMarketPrice(card, state.market.tick, state.market.day);
  const slippage = 1 - Math.min(0.35, BASE_SLIPPAGE_RATE * quantity * 0.5);
  return Math.round(price * (1 - BASE_FEE_RATE) * slippage * quantity);
}

// ── State Accessors ────────────────────────────────────────────────────────
export function getHoldingCount(state: GameState, cardId: string): number {
  return state.player.holdings[cardId] ?? 0;
}

export function getNetWorth(state: GameState): number {
  const holdingsValue = state.market.cards.reduce(
    (sum, card) => sum + getMarketPrice(card, state.market.tick, state.market.day) * getHoldingCount(state, card.id),
    0,
  );
  return state.player.cash + holdingsValue + state.player.creatorWallet;
}

export function getUnrealizedPnl(state: GameState, cardId: string): number {
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card) return 0;
  const qty = getHoldingCount(state, cardId);
  if (qty === 0) return 0;
  const currentPrice = getMarketPrice(card, state.market.tick, state.market.day);
  const avgCost = state.player.avgCost[cardId] ?? currentPrice;
  return Math.round((currentPrice - avgCost) * qty);
}

export function summarizeCard(card: CardDefinition, state: GameState) {
  const price = getMarketPrice(card, state.market.tick, state.market.day);
  const owned = getHoldingCount(state, card.id);
  const avgCost = state.player.avgCost[card.id] ?? price;
  const unrealizedPnl = Math.round((price - avgCost) * owned);
  return {
    price,
    owned,
    positionValue: price * owned,
    totalSupply: card.supplyMode === 'limited' ? card.supply : '∞',
    avgCost,
    unrealizedPnl,
  };
}

export function getProgression(state: GameState) {
  const netWorth = getNetWorth(state);
  const nextLevelTarget = state.player.level * 180;
  return {
    netWorth,
    level: state.player.level,
    xp: state.player.xp,
    nextLevelTarget,
    streak: state.player.loginStreak,
    dailyReady: !state.player.lastDailyRewardAt || Date.now() - state.player.lastDailyRewardAt >= DAILY_REWARD_MS,
  };
}

// ── Persistence ────────────────────────────────────────────────────────────
export function createInitialState(): GameState {
  const cards: CardDefinition[] = [
    {
      id: 'btcn',
      name: 'Sovereign Treasury Chain',
      symbol: 'BTCN',
      category: 'Infrastructure',
      basePrice: 120,
      volatility: 0.18,
      demandBias: 0.04,
      creatorShare: 0.08,
      supplyMode: 'limited',
      supply: 900,
      owned: 0,
      momentum: 0,
      priceHistory: [],
    },
    {
      id: 'ape',
      name: 'Volt Arcade Media',
      symbol: 'APE',
      category: 'Entertainment',
      basePrice: 85,
      volatility: 0.24,
      demandBias: 0.02,
      creatorShare: 0.12,
      supplyMode: 'unlimited',
      supply: 0,
      owned: 0,
      momentum: 0,
      priceHistory: [],
    },
    {
      id: 'gro',
      name: 'Golden Grove Logistics',
      symbol: 'GRO',
      category: 'Supply Chain',
      basePrice: 160,
      volatility: 0.15,
      demandBias: 0.01,
      creatorShare: 0.1,
      supplyMode: 'limited',
      supply: 600,
      owned: 0,
      momentum: 0,
      priceHistory: [],
    },
    {
      id: 'dpp',
      name: 'Daily Ledger Press',
      symbol: 'DPP',
      category: 'Publishing',
      basePrice: 45,
      volatility: 0.31,
      demandBias: -0.01,
      creatorShare: 0.15,
      supplyMode: 'unlimited',
      supply: 0,
      owned: 0,
      momentum: 0,
      priceHistory: [],
    },
    {
      id: 'slp',
      name: 'Slipstream Protocol',
      symbol: 'SLP',
      category: 'DeFi',
      basePrice: 210,
      volatility: 0.28,
      demandBias: 0.06,
      creatorShare: 0.06,
      supplyMode: 'limited',
      supply: 400,
      owned: 0,
      momentum: 0.1,
      priceHistory: [],
    },
    {
      id: 'mnk',
      name: 'Apex Market Fund',
      symbol: 'MNK',
      category: 'Finance',
      basePrice: 320,
      volatility: 0.12,
      demandBias: 0.03,
      creatorShare: 0.05,
      supplyMode: 'unlimited',
      supply: 0,
      owned: 0,
      momentum: -0.05,
      priceHistory: [],
    },
  ];

  return {
    player: {
      cash: 1500,
      xp: 0,
      level: 1,
      holdings: {},
      avgCost: {},
      creatorWallet: 0,
      lastDailyRewardAt: null,
      lastLoginDate: null,
      loginStreak: 0,
      lastTickAt: Date.now(),
      rumors: [],
    },
    market: {
      day: 1,
      tick: 0,
      cards,
      news: [
        {
          id: 'headline-1',
          title: 'Asset futures open strong',
          body: 'Demand is flowing into early-growth cards as new players enter the exchange. Analysts expect volatility through the first week.',
          mood: 'positive',
          impact: '+8% crowd interest',
        },
        {
          id: 'headline-2',
          title: 'Slipstream Protocol spikes on launch day',
          body: 'SLP opened 10% above base price amid heavy speculative buying. Whale accounts already accumulating — watch slippage costs.',
          mood: 'positive',
          impact: 'SLP +10% open',
          cardSymbol: 'SLP',
          priceDelta: 0.1,
        },
      ],
      leaderboard: [
        { name: 'K. Apewell', netWorth: 8100, streak: 18 },
        { name: 'Mango Hwang', netWorth: 6200, streak: 12 },
        { name: 'You', netWorth: 1500, streak: 1 },
      ],
    },
    log: ['Welcome to Yellow Ledger. Buy low, sell high, and publish your own cards when you break through.'],
  };
}

export function loadState(): GameState {
  if (typeof window === 'undefined') return createInitialState();

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createInitialState();

  try {
    const parsed = JSON.parse(raw) as GameState;
    // Migrate old saves — ensure new fields exist
    return {
      ...createInitialState(),
      ...parsed,
      player: {
        ...createInitialState().player,
        ...parsed.player,
        avgCost: parsed.player.avgCost ?? {},
        loginStreak: parsed.player.loginStreak ?? 0,
        lastLoginDate: parsed.player.lastLoginDate ?? null,
        rumors: parsed.player.rumors ?? [],
      },
      market: {
        ...parsed.market,
        cards: parsed.market.cards.map(card => ({
          ...card,
          momentum: card.momentum ?? 0,
          priceHistory: card.priceHistory ?? [],
        })),
      },
    };
  } catch {
    return createInitialState();
  }
}

export function saveState(state: GameState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Core Game Actions ──────────────────────────────────────────────────────
export function buyCard(state: GameState, cardId: string, quantity = 1): GameState {
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card || quantity <= 0) return state;

  // Check limited supply
  if (card.supplyMode === 'limited' && card.supply > 0) {
    const available = card.supply - card.owned;
    if (available <= 0) {
      return { ...state, log: [`${card.symbol} is fully minted — no more supply available.`].concat(state.log).slice(0, 12) };
    }
    quantity = Math.min(quantity, available);
  }

  const cost = getBuyCost(state, cardId, quantity);
  if (cost > state.player.cash) {
    return { ...state, log: [`Not enough cash to buy ${quantity}× ${card.symbol}.`].concat(state.log).slice(0, 12) };
  }

  const prevQty = getHoldingCount(state, cardId);
  const prevAvg = state.player.avgCost[cardId] ?? 0;
  const newAvg = prevQty === 0
    ? Math.round(cost / quantity)
    : Math.round((prevAvg * prevQty + cost) / (prevQty + quantity));

  const holdings = { ...state.player.holdings, [cardId]: prevQty + quantity };
  const avgCost = { ...state.player.avgCost, [cardId]: newAvg };

  const updatedCards = state.market.cards.map(c =>
    c.id === cardId ? { ...c, owned: c.owned + quantity } : c,
  );

  // Creator royalty (small stream to creator wallet — in multiplayer this would go to creator)
  const royalty = Math.round(cost * card.creatorShare * 0.04);

  return {
    ...state,
    player: {
      ...state.player,
      cash: state.player.cash - cost,
      xp: state.player.xp + quantity * 5,
      holdings,
      avgCost,
      creatorWallet: state.player.creatorWallet + (card.publishedByPlayer ? royalty : 0),
    },
    market: { ...state.market, cards: updatedCards },
    log: [`Bought ${quantity}× ${card.symbol} for ${formatCurrency(cost)} (${formatCurrency(Math.round(cost / quantity))} avg).`].concat(state.log).slice(0, 12),
  };
}

export function sellCard(state: GameState, cardId: string, quantity = 1): GameState {
  const card = state.market.cards.find(c => c.id === cardId);
  const current = getHoldingCount(state, cardId);
  if (!card || quantity <= 0 || current < quantity) {
    return state;
  }

  const proceeds = getSellProceeds(state, cardId, quantity);
  const avgCost = state.player.avgCost[cardId] ?? 0;
  const profit = proceeds - avgCost * quantity;
  const xpGain = Math.max(2, Math.round(profit > 0 ? profit * 0.04 : 2)); // XP based on profit

  const newQty = current - quantity;
  const holdings = { ...state.player.holdings };
  const updatedAvgCost = { ...state.player.avgCost };
  if (newQty <= 0) {
    delete holdings[cardId];
    delete updatedAvgCost[cardId];
  } else {
    holdings[cardId] = newQty;
  }

  const updatedCards = state.market.cards.map(c =>
    c.id === cardId ? { ...c, owned: Math.max(0, c.owned - quantity) } : c,
  );

  const profitStr = profit >= 0 ? `+${formatCurrency(profit)}` : formatCurrency(profit);

  return {
    ...state,
    player: {
      ...state.player,
      cash: state.player.cash + proceeds,
      xp: state.player.xp + xpGain,
      holdings,
      avgCost: updatedAvgCost,
    },
    market: { ...state.market, cards: updatedCards },
    log: [`Sold ${quantity}× ${card.symbol} for ${formatCurrency(proceeds)} (${profitStr} P&L).`].concat(state.log).slice(0, 12),
  };
}

export function publishCard(state: GameState, cardDraft: {
  name: string;
  symbol: string;
  category: string;
  basePrice: number;
  volatility: number;
  creatorShare: number;
  supplyMode: SupplyMode;
  supply: number;
}): GameState {
  const minimumNetWorth = 5000;
  if (getNetWorth(state) < minimumNetWorth) {
    return {
      ...state,
      log: [`You need ${formatCurrency(minimumNetWorth)} net worth to publish a card.`].concat(state.log).slice(0, 12),
    };
  }

  const card: CardDefinition = {
    id: `${cardDraft.symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`,
    name: cardDraft.name,
    symbol: cardDraft.symbol.toUpperCase(),
    category: cardDraft.category,
    basePrice: cardDraft.basePrice,
    volatility: cardDraft.volatility,
    demandBias: seededRandom(Date.now()) * 0.08 - 0.02,
    creatorShare: cardDraft.creatorShare,
    supplyMode: cardDraft.supplyMode,
    supply: cardDraft.supplyMode === 'limited' ? cardDraft.supply : 0,
    owned: 0,
    momentum: 0.12, // Launch excitement
    priceHistory: [],
    publishedByPlayer: true,
  };

  const launchHeadline: NewsItem = {
    id: `news-${Date.now()}`,
    title: `${card.symbol} hits the exchange`,
    body: `${card.name} was published with ${Math.round(card.creatorShare * 100)}% creator share and ${card.supplyMode === 'limited' ? `${card.supply} total supply` : 'unlimited supply'}. Analysts are watching closely.`,
    mood: 'positive',
    impact: 'New listing +momentum',
    cardSymbol: card.symbol,
    priceDelta: 0.12,
  };

  return {
    ...state,
    player: {
      ...state.player,
      creatorWallet: state.player.creatorWallet + Math.round(card.basePrice * 5),
      xp: state.player.xp + 150,
    },
    market: {
      ...state.market,
      cards: [card, ...state.market.cards],
      news: [launchHeadline, ...state.market.news].slice(0, 10),
    },
    log: [`Published ${card.name} on Yellow Ledger!`].concat(state.log).slice(0, 12),
  };
}

export function claimDailyReward(state: GameState): GameState {
  const now = Date.now();
  if (state.player.lastDailyRewardAt && now - state.player.lastDailyRewardAt < DAILY_REWARD_MS) {
    return {
      ...state,
      log: ['Daily reward already claimed. Come back tomorrow!'].concat(state.log).slice(0, 12),
    };
  }

  const today = todayString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const lastDate = state.player.lastLoginDate;
  const newStreak = lastDate === yesterday ? state.player.loginStreak + 1 : 1;
  const streakBonus = 1 + 0.1 * Math.min(newStreak, 20); // Max +200% at streak 20
  const baseReward = 400;
  const reward = Math.round(baseReward * streakBonus);
  const xpBonus = 25 + newStreak * 3;

  return {
    ...state,
    player: {
      ...state.player,
      cash: state.player.cash + reward,
      xp: state.player.xp + xpBonus,
      lastDailyRewardAt: now,
      lastLoginDate: today,
      loginStreak: newStreak,
    },
    log: [
      newStreak > 1
        ? `Daily reward claimed: ${formatCurrency(reward)} 🍌 (${newStreak}-day streak × ${streakBonus.toFixed(1)}x!)`
        : `Daily reward claimed: ${formatCurrency(reward)}.`,
    ].concat(state.log).slice(0, 12),
  };
}

// ── Information Economy Options ────────────────────────────────────────────
export function buyRumor(state: GameState): GameState {
  const cost = 500;
  if (state.player.cash < cost) {
    return { ...state, log: [`You need ${formatCurrency(cost)} to buy a rumor.`].concat(state.log).slice(0, 12) };
  }

  // Peek ahead to find next event
  let hint = 'Insiders are quiet. No major events expected soon.';
  for (let t = state.market.tick + 1; t <= state.market.tick + 20; t++) {
    const eventRoll = seededRandom(t * 7 + 13);
    const triggerEvent = eventRoll > 0.88;
    if (triggerEvent) {
      const eventTargetIndex = Math.floor(seededRandom(t) * state.market.cards.length);
      const targetCard = state.market.cards[eventTargetIndex];
      // Rumors might be inaccurate if cards list changes, adding fun chaos
      hint = `Whispers say ${targetCard.symbol} might see major movement around tick ${t}.`;
      break;
    }
  }

  return {
    ...state,
    player: {
      ...state.player,
      cash: state.player.cash - cost,
      rumors: [hint, ...(state.player.rumors ?? [])].slice(0, 10),
    },
    log: [`Bought an insider rumor for ${formatCurrency(cost)}.`].concat(state.log).slice(0, 12),
  };
}

export function runAdCampaign(state: GameState, cardId: string): GameState {
  const cost = 1000;
  if (state.player.cash < cost) {
    return { ...state, log: [`Not enough cash for an ad campaign. Need ${formatCurrency(cost)}.`].concat(state.log).slice(0, 12) };
  }

  const cardIndex = state.market.cards.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return state;

  const card = state.market.cards[cardIndex];
  const updatedCards = [...state.market.cards];
  updatedCards[cardIndex] = {
    ...card,
    momentum: clamp((card.momentum ?? 0) + 0.25, -0.45, 0.45),
    demandBias: clamp(card.demandBias + 0.08, -0.12, 0.15),
  };

  return {
    ...state,
    player: {
      ...state.player,
      cash: state.player.cash - cost,
    },
    market: { ...state.market, cards: updatedCards },
    log: [`Launched an ad campaign for ${card.symbol}. Momentum boosted! (-${formatCurrency(cost)})`].concat(state.log).slice(0, 12),
  };
}

// ── Market Tick ────────────────────────────────────────────────────────────
const eventTemplates = [
  { title: 'Market shortage hits the exchange', body: 'Supply constraints push prices up across limited-supply cards.', mood: 'positive' as const, momentumRange: [0.12, 0.22] },
  { title: 'Ledger Protocol upgrade announced', body: 'Governance vote passes — infrastructure cards rally.', mood: 'positive' as const, momentumRange: [0.08, 0.18] },
  { title: 'Prime Media acquires DPP stake', body: 'Publishing card spikes on merger speculation.', mood: 'positive' as const, momentumRange: [0.10, 0.20] },
  { title: 'Regulatory uncertainty clouds the market', body: 'Traders pull back from high-volatility positions.', mood: 'negative' as const, momentumRange: [-0.15, -0.06] },
  { title: 'Creator royalties reach record highs', body: 'Player-issued cards generate outsized returns for creators this week.', mood: 'positive' as const, momentumRange: [0.05, 0.15] },
  { title: 'Flash crash in supply-chain cards', body: 'GRO tumbles briefly before buy orders stabilize the floor.', mood: 'negative' as const, momentumRange: [-0.18, -0.08] },
  { title: 'Arbitrage bots punished by slippage update', body: 'New anti-whale measures make large rapid trades more costly.', mood: 'neutral' as const, momentumRange: [-0.04, 0.04] },
];

const routineTemplates: NewsItem[] = [
  { id: '', title: 'Liquidity thickens on Yellow Ledger', body: 'Spreads narrowed slightly as market makers entered more positions. Patient traders benefit most.', mood: 'positive', impact: 'lower fees for limit orders' },
  { id: '', title: 'Momentum indicators flash mixed signals', body: 'Short-term trend followers are cautious as oscillators reach neutral zones.', mood: 'neutral', impact: 'watch volatility' },
  { id: '', title: 'Creator wallets distributed on schedule', body: 'Royalty streams credited to all active card publishers. Passive income is the new alpha.', mood: 'positive', impact: 'royalties credited' },
  { id: '', title: 'Scarcity premium builds in limited cards', body: 'As mint counts approach supply caps, early holders are sitting on significant unrealized gains.', mood: 'positive', impact: 'limited supply premium +8%' },
  { id: '', title: 'New traders enter the exchange in waves', body: 'Onboarding activity is up. More buyers means higher natural demand pressure across the board.', mood: 'positive', impact: 'crowd interest +5%' },
];

export function advanceMarket(state: GameState): GameState {
  const tick = state.market.tick + 1;
  const day = tick % 12 === 0 ? state.market.day + 1 : state.market.day;

  // Roll for market event every ~8 ticks
  const eventRoll = seededRandom(tick * 7 + 13);
  const triggerEvent = eventRoll > 0.88;
  const eventTemplate = triggerEvent ? eventTemplates[Math.floor(eventRoll * eventTemplates.length * 10) % eventTemplates.length] : null;
  const eventTargetIndex = triggerEvent ? Math.floor(seededRandom(tick) * state.market.cards.length) : -1;

  const nextCards = state.market.cards.map((card, index) => {
    const phase = seededRandom(hashString(card.id) + tick + index);
    const noise = (seededRandom(tick + index * 13) - 0.5) * 0.06;
    const algorithmicPressure = phase > 0.84 ? 0.08 : phase < 0.10 ? -0.07 : 0;

    // Demand bias drift — slowly mean-reverts toward 0 to prevent permanent positive bias
    const meanReversionPull = -card.demandBias * 0.05;
    const nextBias = clamp(card.demandBias + noise * 0.12 + algorithmicPressure * 0.04 + meanReversionPull, -0.12, 0.15);

    // Momentum decay: 85% retention per tick
    let nextMomentum = (card.momentum ?? 0) * 0.82;

    // If this card is the event target, inject momentum spike
    if (triggerEvent && eventTemplate && index === eventTargetIndex) {
      const [lo, hi] = eventTemplate.momentumRange;
      nextMomentum += lo + seededRandom(tick + index) * (hi - lo);
    }
    nextMomentum = clamp(nextMomentum, -0.45, 0.45);

    // Base price drift — small structural drift, keeps game feeling alive
    const baseDrift = 1 + (seededRandom(tick * 3 + index) - 0.498) * 0.012;
    const nextBase = Math.round(clamp(card.basePrice * baseDrift, 18, 2000));

    // Record current price into history
    const currentPrice = getMarketPrice(card, tick, day);
    const priceHistory = [...(card.priceHistory ?? []), currentPrice].slice(-MAX_PRICE_HISTORY);

    return {
      ...card,
      demandBias: nextBias,
      basePrice: nextBase,
      momentum: nextMomentum,
      priceHistory,
    };
  });

  // Build news item for this tick
  let tickNews: NewsItem;
  if (triggerEvent && eventTemplate && eventTargetIndex >= 0) {
    const targetCard = state.market.cards[eventTargetIndex];
    const [lo, hi] = eventTemplate.momentumRange;
    const priceDelta = (lo + hi) / 2;
    const impactStr = priceDelta >= 0 ? `${targetCard.symbol} +${Math.round(priceDelta * 100)}%` : `${targetCard.symbol} ${Math.round(priceDelta * 100)}%`;
    tickNews = {
      id: `n-${tick}`,
      title: eventTemplate.title,
      body: eventTemplate.body,
      mood: eventTemplate.mood,
      impact: impactStr,
      cardSymbol: targetCard.symbol,
      priceDelta,
    };
  } else {
    const routine = routineTemplates[tick % routineTemplates.length];
    tickNews = { ...routine, id: `n-${tick}` };
  }

  const leaderboard = state.market.leaderboard
    .map(entry => ({
      ...entry,
      netWorth: entry.name === 'You'
        ? Math.round(getNetWorth(state))
        : Math.round(entry.netWorth * (0.992 + seededRandom(entry.netWorth + tick) * 0.025)),
      streak: entry.name === 'You'
        ? Math.max(1, state.player.loginStreak)
        : entry.streak + (seededRandom(entry.netWorth + tick) > 0.75 ? 1 : 0),
    }))
    .sort((a, b) => b.netWorth - a.netWorth)
    .slice(0, 10);

  return {
    ...state,
    player: {
      ...state.player,
      level: Math.max(1, Math.floor(state.player.xp / 180) + 1),
      lastTickAt: Date.now(),
    },
    market: {
      ...state.market,
      tick,
      day,
      cards: nextCards,
      news: [tickNews, ...state.market.news].slice(0, 10),
      leaderboard,
    },
    log: state.log,
  };
}

// ── Creator Draft Builder ──────────────────────────────────────────────────
const draftNames = ['LedgerX', 'GoldCoin', 'Cipher Media', 'Golden Grove', 'Slipstream', 'Cargo Citrus', 'Tropicana', 'Sundowner'];
const draftCategories = ['Culture', 'Energy', 'AI', 'Logistics', 'Media', 'Finance', 'Gaming', 'Health'];

export function buildCardDraftFromSeed(seed: string) {
  const base = hashString(seed);
  const supplyMode: SupplyMode = base % 2 === 0 ? 'limited' : 'unlimited';
  return {
    name: `${draftNames[base % draftNames.length]} ${base % 2 === 0 ? 'Index' : 'Trust'}`,
    symbol: seed.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'X'),
    category: draftCategories[base % draftCategories.length],
    basePrice: 60 + (base % 12) * 20,
    volatility: 0.14 + (base % 7) * 0.03,
    creatorShare: 0.05 + (base % 4) * 0.03,
    supplyMode,
    supply: 250 + (base % 9) * 75,
  };
}

export function getMaxAffordableQuantity(state: GameState, cardId: string, maxQty = 100): number {
  for (let q = maxQty; q >= 1; q--) {
    if (getBuyCost(state, cardId, q) <= state.player.cash) return q;
  }
  return 0;
}