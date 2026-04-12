import { randomUUID } from 'crypto';
import path from 'path';
import { prisma } from './prisma.js';
import {
  advanceMarket,
  buyCard,
  buyRumor,
  claimDailyReward,
  createInitialState,
  getMarketPrice,
  getNetWorth,
  publishCard,
  runAdCampaign,
  sellCard,
  getBuyCost,
  getSellProceeds,
  type CardDefinition,
  type GameState,
  type LeaderboardEntry,
  type MarketState,
  type NewsItem,
  type PlayerState,
} from '../src/game';

const STORE_PATH = path.join(process.cwd(), 'server', 'data', 'store.json');

export type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
  lastLoginAt: string | null;
};

export type TradeRecord = {
  id: string;
  userId: string;
  cardId: string;
  cardSymbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  pricePerUnit: number;
  feePaid: number;
  slippagePaid: number;
  totalValue: number;
  pnl: number;
  executedAt: string;
  marketTick: number;
};

export type ProfileRecord = {
  player: PlayerState;
  log: string[];
  trades: TradeRecord[];
};

export type MarketEvent = {
  id: string;
  title: string;
  body: string;
  mood: NewsItem['mood'];
  impact: string;
  cardSymbol?: string;
  createdAt: string;
};

export type Store = {
  users: StoredUser[];
  profiles: Record<string, ProfileRecord>;
  market: MarketState;
  events: MarketEvent[];
  circuitBreakers: Record<string, CircuitBreakerState>;
  anomalyFlags: Record<string, AnomalyFlags>;
};

export type TradeResult = {
  state: GameState;
  trade: TradeRecord;
};

export type AuditEntry = {
  id: string;
  userId?: string;
  action: 'buy' | 'sell' | 'publish' | 'claim_reward' | 'login' | 'signup' | 'reset' | 'publish_failed' | 'trade_rejected' | 'reward_rejected';
  cardId?: string;
  quantity?: number;
  reason?: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type ValidationError = {
  code: string;
  message: string;
};

export type CircuitBreakerState = {
  cardId: string;
  isBroken: boolean;
  reason: string;
  brokenAt: string;
  recoversAt: string;
  maxPriceChangePercent: number;
};

export type AnomalyFlags = {
  isWashTrading: boolean;
  washTradingScore: number;
  isUnusualVolume: boolean;
  volumeDeviation: number;
  isPriceSpike: boolean;
  priceChangePercent: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
};

// ── Helpers ────────────────────────────────────────────────────────────────
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Validation ────────────────────────────────────────────────────────────
export function validateBuy(state: GameState, cardId: string, quantity: number): ValidationError | null {
  if (quantity <= 0 || quantity >= 1000) return { code: 'INVALID_QUANTITY', message: 'Quantity must be 1-999' };
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card) return { code: 'CARD_NOT_FOUND', message: 'Card does not exist' };
  if (card.supplyMode === 'limited' && card.supply > 0 && card.owned >= card.supply) {
    return { code: 'OUT_OF_STOCK', message: 'Card is fully minted' };
  }
  if (getBuyCost(state, cardId, quantity) > state.player.cash) {
    return { code: 'INSUFFICIENT_CASH', message: 'Not enough cash for this trade' };
  }
  return null;
}

export function validateSell(state: GameState, cardId: string, quantity: number): ValidationError | null {
  if (quantity <= 0 || quantity >= 1000) return { code: 'INVALID_QUANTITY', message: 'Quantity must be 1-999' };
  const card = state.market.cards.find(c => c.id === cardId);
  if (!card) return { code: 'CARD_NOT_FOUND', message: 'Card does not exist' };
  const holding = state.player.holdings[cardId] ?? 0;
  if (holding < quantity) return { code: 'INSUFFICIENT_HOLDINGS', message: 'Not enough cards to sell' };
  return null;
}

export function validatePublish(state: GameState, payload: {
  name: string; symbol: string; category: string; basePrice: number;
  volatility: number; creatorShare: number; supplyMode: string; supply: number;
}): ValidationError | null {
  if (getNetWorth(state) < 5000) return { code: 'INSUFFICIENT_NET_WORTH', message: 'Minimum $5,000 net worth required' };
  if (!payload.name || payload.name.length < 2 || payload.name.length > 40) {
    return { code: 'INVALID_NAME', message: 'Card name must be 2-40 characters' };
  }
  if (!payload.symbol || payload.symbol.length < 2 || payload.symbol.length > 6) {
    return { code: 'INVALID_SYMBOL', message: 'Symbol must be 2-6 characters' };
  }
  if (payload.basePrice < 10 || payload.basePrice > 5000) {
    return { code: 'INVALID_PRICE', message: 'Base price must be $10–$5,000' };
  }
  if (payload.volatility < 0.05 || payload.volatility > 1) {
    return { code: 'INVALID_VOLATILITY', message: 'Volatility must be 0.05–1.0' };
  }
  if (payload.creatorShare < 0.02 || payload.creatorShare > 0.4) {
    return { code: 'INVALID_CREATOR_SHARE', message: 'Creator share must be 2%–40%' };
  }
  if (payload.supplyMode === 'limited' && (payload.supply < 1 || payload.supply > 10000)) {
    return { code: 'INVALID_SUPPLY', message: 'Supply cap must be 1–10,000 for limited cards' };
  }
  return null;
}

export function validateRewardClaim(state: GameState): ValidationError | null {
  if (!state.player.lastDailyRewardAt) return null;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - state.player.lastDailyRewardAt < dayMs) {
    return { code: 'REWARD_ALREADY_CLAIMED', message: 'Daily reward already claimed today' };
  }
  return null;
}

// ── Anomaly Detection & Circuit Breakers ──────────────────────────────────
export function detectAnomalies(store: Store, userId: string, cardId: string, quantity: number, side: 'buy' | 'sell'): AnomalyFlags {
  const profile = store.profiles[userId];
  const card = store.market.cards.find(c => c.id === cardId);
  if (!profile || !card) {
    return { isWashTrading: false, washTradingScore: 0, isUnusualVolume: false, volumeDeviation: 0, isPriceSpike: false, priceChangePercent: 0, riskLevel: 'low' };
  }

  // Detect wash trading: rapid alternating buy/sell on same card
  const recentTrades = profile.trades.slice(0, 10);
  let washScore = 0;
  let altCount = 0;
  for (let i = 0; i < Math.min(recentTrades.length - 1, 5); i++) {
    const trade1 = recentTrades[i];
    const trade2 = recentTrades[i + 1];
    if (trade1.cardId === cardId && trade2.cardId === cardId && trade1.side !== trade2.side) {
      const timeDiffMs = new Date(trade1.executedAt).getTime() - new Date(trade2.executedAt).getTime();
      if (timeDiffMs < 60_000) {
        // Within 60 seconds
        washScore += 25;
        altCount++;
      }
    }
  }
  const isWashTrading = washScore > 50 || altCount >= 3;

  // Detect unusual volume: compare current trade vs historical average
  const avgQuantity = recentTrades.length > 0 ? recentTrades.reduce((sum, t) => sum + t.quantity, 0) / recentTrades.length : 1;
  const volumeRatio = quantity / (avgQuantity || 1);
  const isUnusualVolume = volumeRatio > 5 || volumeRatio < 0.2;
  const volumeDeviation = Math.round(((volumeRatio - 1) * 100) / (avgQuantity || 1));

  // Detect price spike: check card's price history
  const priceHistory = card.priceHistory ?? [];
  let priceChangePercent = 0;
  if (priceHistory.length >= 2) {
    const prevPrice = priceHistory[priceHistory.length - 2];
    const currPrice = priceHistory[priceHistory.length - 1];
    priceChangePercent = Math.round(((currPrice - prevPrice) / prevPrice) * 100);
  }
  const isPriceSpike = Math.abs(priceChangePercent) > 50;

  // Calculate overall risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  const riskScore = (isWashTrading ? 30 : 0) + (isUnusualVolume ? 20 : 0) + (isPriceSpike ? 20 : 0);
  if (riskScore >= 50) riskLevel = 'critical';
  else if (riskScore >= 35) riskLevel = 'high';
  else if (riskScore >= 15) riskLevel = 'medium';

  return {
    isWashTrading,
    washTradingScore: washScore,
    isUnusualVolume,
    volumeDeviation,
    isPriceSpike,
    priceChangePercent,
    riskLevel,
  };
}

export function isCircuitBreakerActive(store: Store, cardId: string): boolean {
  const cb = store.circuitBreakers[cardId];
  if (!cb) return false;
  if (cb.isBroken && new Date(cb.recoversAt).getTime() > Date.now()) return true;
  // Auto-recover if recovery time has passed
  if (cb.isBroken && new Date(cb.recoversAt).getTime() <= Date.now()) {
    cb.isBroken = false;
  }
  return false;
}

export function activateCircuitBreaker(store: Store, cardId: string, reason: string, durationMs = 300_000) {
  const recoversAt = new Date(Date.now() + durationMs).toISOString();
  store.circuitBreakers[cardId] = {
    cardId,
    isBroken: true,
    reason,
    brokenAt: new Date().toISOString(),
    recoversAt,
    maxPriceChangePercent: 0,
  };
}

// ── Audit Logging ──────────────────────────────────────────────────────────
let auditLog: AuditEntry[] = [];

export function logAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>) {
  const auditEntry: AuditEntry = {
    id: randomUUID(),
    ...entry,
    createdAt: new Date().toISOString(),
  };
  auditLog.push(auditEntry);
  // Keep only last 10k entries
  if (auditLog.length > 10000) auditLog = auditLog.slice(-10000);
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog];
}

function createProfile() {
  const seed = createInitialState();
  return {
    player: clone(seed.player),
    log: [...seed.log],
    trades: [],
  } satisfies ProfileRecord;
}

function levelFromXp(xp: number) {
  return Math.max(1, Math.floor(xp / 180) + 1);
}

function normalizePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    level: levelFromXp(player.xp),
    avgCost: player.avgCost ?? {},
    loginStreak: player.loginStreak ?? 0,
    lastLoginDate: player.lastLoginDate ?? null,
  };
}

function ensureCards(cards: CardDefinition[]): CardDefinition[] {
  return cards.map(card => ({
    ...card,
    momentum: card.momentum ?? 0,
    priceHistory: card.priceHistory ?? [],
  }));
}

// ── Persistence ────────────────────────────────────────────────────────────
function createSeedStore(): Store {
  const seed = createInitialState();
  return {
    users: [],
    profiles: {},
    market: { ...seed.market, leaderboard: [], cards: ensureCards(seed.market.cards) },
    events: [
      {
        id: 'liquidity-shortage',
        title: 'Market Liquidity Crunch',
        body: 'All prices surge as supply tightens across the exchange.',
        mood: 'positive',
        impact: 'Asset shortage +12%',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'whale-watch',
        title: 'Whale watch alert',
        body: 'Large wallets face increasing taxes and slippage. The anti-whale system is live.',
        mood: 'neutral',
        impact: 'anti-whale slippage active',
        createdAt: new Date().toISOString(),
      },
    ],
    circuitBreakers: {},
    anomalyFlags: {},
  };
}

function ensureStoreShape(store: Store): Store {
  const seed = createInitialState();
  return {
    users: store.users ?? [],
    profiles: store.profiles ?? {},
    market: {
      ...seed.market,
      ...store.market,
      cards: ensureCards(store.market?.cards ?? seed.market.cards),
      leaderboard: store.market?.leaderboard ?? [],
    },
    events: store.events ?? [],
    circuitBreakers: store.circuitBreakers ?? {},
    anomalyFlags: store.anomalyFlags ?? {},
  };
}

export async function loadStore(): Promise<Store> {
  try {
    const users = await prisma.user.findMany({
      include: { trades: true, holdings: true }
    });
    
    if (users.length === 0) {
      const seed = createSeedStore();
      await saveStore(seed);
      return seed;
    }

    const cards = await prisma.card.findMany();
    const globalState = await prisma.globalState.findUnique({ where: { id: 1 } });
    const events = await prisma.marketEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    const circuitBreakers = await prisma.circuitBreaker.findMany();
    const anomalyFlags = await prisma.anomalyFlag.findMany();

    const store: Store = {
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        passwordHash: u.passwordHash,
        displayName: u.displayName,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      })),
      profiles: {},
      market: {
        day: globalState?.day ?? 1,
        tick: globalState?.tick ?? 0,
        leaderboard: [],
        news: JSON.parse(globalState?.news ?? "[]"),
        cards: cards.map(c => ({
          ...c,
          publisherId: c.publisherId ?? undefined,
          supplyMode: c.supplyMode as any,
          priceHistory: JSON.parse(c.priceHistory || "[]"),
        }))
      },
      events: events.map(e => ({
        ...e,
        cardSymbol: e.cardSymbol ?? undefined,
        mood: e.mood as any,
        createdAt: e.createdAt.toISOString(),
      })),
      circuitBreakers: circuitBreakers.reduce((acc, cb) => {
        acc[cb.cardId] = {
          ...cb,
          brokenAt: cb.brokenAt.toISOString(),
          recoversAt: cb.recoversAt.toISOString(),
        };
        return acc;
      }, {} as Record<string, CircuitBreakerState>),
      anomalyFlags: anomalyFlags.reduce((acc, af) => {
        acc[`${af.userId}:${af.cardId}`] = {
          ...af,
          riskLevel: af.riskLevel as any,
        };
        return acc;
      }, {} as Record<string, AnomalyFlags>),
    };

    for (const u of users) {
      const holdings: Record<string, number> = {};
      const avgCost: Record<string, number> = {};
      for (const h of u.holdings) {
        holdings[h.cardId] = h.qty;
        avgCost[h.cardId] = h.avgCost;
      }
      store.profiles[u.id] = {
        player: {
          cash: u.cash,
          xp: u.xp,
          level: u.level,
          creatorWallet: u.creatorWallet,
          loginStreak: u.loginStreak,
          holdings,
          avgCost,
          lastTickAt: u.lastTickAt.getTime(),
          lastLoginDate: u.lastLoginDate,
          lastDailyRewardAt: u.lastDailyRewardAt ? u.lastDailyRewardAt.getTime() : null,
          rumors: JSON.parse(u.rumors || "[]"),
        },
        log: [], 
        trades: u.trades.map(t => ({
          ...t,
          executedAt: t.executedAt.toISOString(),
          side: t.side as 'buy'|'sell',
        })).sort((a,b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()),
      };
    }

    return ensureStoreShape(store);
  } catch (e) {
    console.error("Prisma load error:", e);
    return createSeedStore();
  }
}

export async function saveStore(store: Store) {
  // Sync Users and Profiles
  for (const user of store.users) {
    const profile = store.profiles[user.id];
    if (!profile) continue;
    
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
        cash: profile.player.cash,
        xp: profile.player.xp,
        level: profile.player.level,
        creatorWallet: profile.player.creatorWallet,
        loginStreak: profile.player.loginStreak,
        lastTickAt: new Date(profile.player.lastTickAt),
        lastLoginDate: profile.player.lastLoginDate,
        lastDailyRewardAt: profile.player.lastDailyRewardAt ? new Date(profile.player.lastDailyRewardAt) : null,
        rumors: JSON.stringify(profile.player.rumors ?? []),
      },
      create: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        displayName: user.displayName,
        createdAt: new Date(user.createdAt),
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
        cash: profile.player.cash,
        xp: profile.player.xp,
        level: profile.player.level,
        creatorWallet: profile.player.creatorWallet,
        loginStreak: profile.player.loginStreak,
        lastTickAt: new Date(profile.player.lastTickAt),
        lastLoginDate: profile.player.lastLoginDate,
        lastDailyRewardAt: profile.player.lastDailyRewardAt ? new Date(profile.player.lastDailyRewardAt) : null,
        rumors: JSON.stringify(profile.player.rumors ?? []),
      }
    });

    for (const [cardId, qty] of Object.entries(profile.player.holdings)) {
      if (qty > 0) {
        await prisma.holding.upsert({
          where: { userId_cardId: { userId: user.id, cardId } },
          update: { qty, avgCost: profile.player.avgCost[cardId] ?? 0 },
          create: { userId: user.id, cardId, qty, avgCost: profile.player.avgCost[cardId] ?? 0 },
        });
      } else {
        await prisma.holding.deleteMany({ where: { userId: user.id, cardId } });
      }
    }

    for (const trade of profile.trades) {
      await prisma.trade.upsert({
        where: { id: trade.id },
        update: {},
        create: {
          id: trade.id,
          userId: trade.userId,
          cardId: trade.cardId,
          cardSymbol: trade.cardSymbol,
          side: trade.side,
          quantity: trade.quantity,
          pricePerUnit: trade.pricePerUnit,
          feePaid: trade.feePaid,
          slippagePaid: trade.slippagePaid,
          totalValue: trade.totalValue,
          pnl: trade.pnl,
          executedAt: new Date(trade.executedAt),
          marketTick: trade.marketTick,
        }
      });
    }
  }

  // Sync Cards
  for (const card of store.market.cards) {
    await prisma.card.upsert({
      where: { id: card.id },
      update: {
        basePrice: card.basePrice,
        demandBias: card.demandBias,
        owned: card.owned,
        momentum: card.momentum,
        priceHistory: JSON.stringify(card.priceHistory ?? []),
      },
      create: {
        id: card.id,
        name: card.name,
        symbol: card.symbol,
        category: card.category,
        basePrice: card.basePrice,
        volatility: card.volatility,
        demandBias: card.demandBias,
        creatorShare: card.creatorShare,
        supplyMode: card.supplyMode,
        supply: card.supply,
        owned: card.owned,
        momentum: card.momentum,
        priceHistory: JSON.stringify(card.priceHistory ?? []),
        publishedByPlayer: card.publishedByPlayer ?? false,
        publisherId: card.publisherId,
      }
    });
  }

  await prisma.globalState.upsert({
    where: { id: 1 },
    update: { day: store.market.day, tick: store.market.tick, news: JSON.stringify(store.market.news ?? []) },
    create: { id: 1, day: store.market.day, tick: store.market.tick, news: JSON.stringify(store.market.news ?? []) },
  });
}

// ── User CRUD ──────────────────────────────────────────────────────────────
export function getUser(store: Store, userId: string) {
  return store.users.find(u => u.id === userId) ?? null;
}

export function getUserByEmail(store: Store, email: string) {
  return store.users.find(u => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export function createUser(store: Store, input: { email: string; passwordHash: string; displayName: string }) {
  const id = randomUUID();
  const user: StoredUser = {
    id,
    email: input.email.toLowerCase(),
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  store.users.push(user);
  store.profiles[id] = createProfile();
  refreshLeaderboard(store);
  return user;
}

export function touchLogin(store: Store, userId: string) {
  const user = getUser(store, userId);
  if (user) user.lastLoginAt = new Date().toISOString();
}

// ── State Building ─────────────────────────────────────────────────────────
function buildState(store: Store, userId: string): GameState {
  const profile = store.profiles[userId] ?? createProfile();
  return {
    player: normalizePlayer(profile.player),
    market: { ...store.market, leaderboard: [...store.market.leaderboard] },
    log: [...profile.log],
  };
}

export function getGameState(store: Store, userId: string) {
  return buildState(store, userId);
}

export function getPortfolio(store: Store, userId: string) {
  const state = buildState(store, userId);
  return state.market.cards
    .map(card => ({
      ...card,
      holdings: state.player.holdings[card.id] ?? 0,
      avgCost: state.player.avgCost[card.id] ?? 0,
      currentPrice: getMarketPrice(card, state.market.tick, state.market.day),
      positionValue: (state.player.holdings[card.id] ?? 0) * getMarketPrice(card, state.market.tick, state.market.day),
      unrealizedPnl: ((state.player.holdings[card.id] ?? 0) > 0)
        ? Math.round((getMarketPrice(card, state.market.tick, state.market.day) - (state.player.avgCost[card.id] ?? 0)) * (state.player.holdings[card.id] ?? 0))
        : 0,
    }))
    .filter(card => card.holdings > 0);
}

export function getTrades(store: Store, userId: string) {
  return store.profiles[userId]?.trades ?? [];
}

export function getNews(store: Store) {
  return [...store.market.news].slice(0, 10);
}

export function getEvents(store: Store) {
  return [...store.events].slice(0, 10);
}

// ── Leaderboard ────────────────────────────────────────────────────────────
export function getLeaderboard(store: Store) {
  return buildLeaderboard(store);
}

function buildLeaderboard(store: Store): LeaderboardEntry[] {
  const board = store.users.map(user => {
    const profile = store.profiles[user.id] ?? createProfile();
    const state: GameState = {
      player: normalizePlayer(profile.player),
      market: { ...store.market, leaderboard: [] },
      log: [],
    };
    return {
      name: user.displayName,
      netWorth: Math.round(getNetWorth(state)),
      streak: Math.max(1, profile.player.loginStreak ?? 0),
    } satisfies LeaderboardEntry;
  });
  board.sort((a, b) => b.netWorth - a.netWorth);
  return board.slice(0, 10).map((entry, i) => ({ ...entry, rank: i + 1 }));
}

export function refreshLeaderboard(store: Store) {
  store.market.leaderboard = buildLeaderboard(store);
}

// ── Persistence helpers ────────────────────────────────────────────────────
function persistProfileState(store: Store, userId: string, nextState: GameState) {
  const profile = store.profiles[userId] ?? createProfile();
  profile.player = normalizePlayer(nextState.player);
  profile.log = [...nextState.log].slice(0, 12);
  store.profiles[userId] = profile;
  store.market = { ...nextState.market, leaderboard: [] };
  refreshLeaderboard(store);
}

function createTradeRecord(
  store: Store, userId: string, cardId: string, side: 'buy' | 'sell',
  quantity: number, before: GameState, after: GameState,
): TradeRecord {
  const card = before.market.cards.find(c => c.id === cardId);
  const pricePerUnit = card ? getMarketPrice(card, before.market.tick, before.market.day) : 0;
  const totalValue = side === 'buy'
    ? Math.max(0, before.player.cash - after.player.cash)
    : Math.max(0, after.player.cash - before.player.cash);
  const nominalValue = pricePerUnit * quantity;
  const feePaid = Math.max(0, Math.round(nominalValue * 0.02));
  const slippagePaid = Math.max(0, Math.round(Math.abs(totalValue - nominalValue - feePaid)));
  const avgCost = before.player.avgCost[cardId] ?? pricePerUnit;
  const pnl = side === 'sell' ? Math.round((pricePerUnit - avgCost) * quantity) : 0;

  return {
    id: randomUUID(),
    userId,
    cardId,
    cardSymbol: card?.symbol ?? cardId,
    side,
    quantity,
    pricePerUnit,
    feePaid,
    slippagePaid,
    totalValue,
    pnl,
    executedAt: new Date().toISOString(),
    marketTick: before.market.tick,
  };
}

function appendTrade(store: Store, userId: string, trade: TradeRecord) {
  const profile = store.profiles[userId] ?? createProfile();
  profile.trades = [trade, ...profile.trades].slice(0, 100);
  store.profiles[userId] = profile;
}

// ── Game Mutations ─────────────────────────────────────────────────────────
export function buyForUser(store: Store, userId: string, cardId: string, quantity = 1): TradeResult | null {
  const before = buildState(store, userId);
  
  // Check circuit breaker
  if (isCircuitBreakerActive(store, cardId)) {
    const cb = store.circuitBreakers[cardId];
    logAudit({
      userId,
      action: 'trade_rejected',
      cardId,
      quantity,
      reason: 'CIRCUIT_BREAKER_ACTIVE',
      details: { reason: cb?.reason, recoversAt: cb?.recoversAt },
    });
    return null;
  }
  
  // Validate first
  const validation = validateBuy(before, cardId, quantity);
  if (validation) {
    logAudit({
      userId,
      action: 'trade_rejected',
      cardId,
      quantity,
      reason: validation.code,
      details: { code: validation.code, message: validation.message },
    });
    return null;
  }
  
  // Detect anomalies
  const anomalies = detectAnomalies(store, userId, cardId, quantity, 'buy');
  store.anomalyFlags[`${userId}:${cardId}`] = anomalies;
  
  // Reject critical risk trades
  if (anomalies.riskLevel === 'critical') {
    logAudit({
      userId,
      action: 'trade_rejected',
      cardId,
      quantity,
      reason: 'ANOMALY_CRITICAL',
      details: { anomalies, explanation: 'Critical risk detected: possible wash trading or manipulation' },
    });
    return null;
  }
  
  // Log warning for high-risk trades but allow them
  if (anomalies.riskLevel === 'high') {
    logAudit({
      userId,
      action: 'buy',
      cardId,
      quantity,
      reason: 'HIGH_RISK_TRADE',
      details: {
        pricePerUnit: 0,
        anomalies,
        warning: 'High-risk trade allowed with monitoring',
      },
    });
  }
  
  const nextState = buyCard(before, cardId, quantity);
  if (nextState === before) return null;

  const trade = createTradeRecord(store, userId, cardId, 'buy', quantity, before, nextState);
  persistProfileState(store, userId, nextState);
  appendTrade(store, userId, trade);
  
  // Audit successful trade
  logAudit({
    userId,
    action: 'buy',
    cardId,
    quantity,
    details: {
      pricePerUnit: trade.pricePerUnit,
      totalValue: trade.totalValue,
      feePaid: trade.feePaid,
      slippagePaid: trade.slippagePaid,
      riskLevel: anomalies.riskLevel,
    },
  });
  
  return { state: buildState(store, userId), trade };
}

export function sellForUser(store: Store, userId: string, cardId: string, quantity = 1): TradeResult | null {
  const before = buildState(store, userId);
  
  // Check circuit breaker
  if (isCircuitBreakerActive(store, cardId)) {
    const cb = store.circuitBreakers[cardId];
    logAudit({
      userId,
      action: 'trade_rejected',
      cardId,
      quantity,
      reason: 'CIRCUIT_BREAKER_ACTIVE',
      details: { reason: cb?.reason, recoversAt: cb?.recoversAt },
    });
    return null;
  }
  
  // Validate first
  const validation = validateSell(before, cardId, quantity);
  if (validation) {
    logAudit({
      userId,
      action: 'trade_rejected',
      cardId,
      quantity,
      reason: validation.code,
      details: { code: validation.code, message: validation.message },
    });
    return null;
  }
  
  // Detect anomalies
  const anomalies = detectAnomalies(store, userId, cardId, quantity, 'sell');
  store.anomalyFlags[`${userId}:${cardId}`] = anomalies;
  
  // Reject critical risk trades
  if (anomalies.riskLevel === 'critical') {
    logAudit({
      userId,
      action: 'trade_rejected',
      cardId,
      quantity,
      reason: 'ANOMALY_CRITICAL',
      details: { anomalies, explanation: 'Critical risk detected: possible wash trading or manipulation' },
    });
    return null;
  }
  
  // Log warning for high-risk trades but allow them
  if (anomalies.riskLevel === 'high') {
    logAudit({
      userId,
      action: 'sell',
      cardId,
      quantity,
      reason: 'HIGH_RISK_TRADE',
      details: {
        pricePerUnit: 0,
        anomalies,
        warning: 'High-risk trade allowed with monitoring',
      },
    });
  }
  
  const nextState = sellCard(before, cardId, quantity);
  if (nextState === before) return null;

  const trade = createTradeRecord(store, userId, cardId, 'sell', quantity, before, nextState);
  persistProfileState(store, userId, nextState);
  appendTrade(store, userId, trade);
  
  // Audit successful trade
  logAudit({
    userId,
    action: 'sell',
    cardId,
    quantity,
    details: {
      pricePerUnit: trade.pricePerUnit,
      totalValue: trade.totalValue,
      feePaid: trade.feePaid,
      slippagePaid: trade.slippagePaid,
      pnl: trade.pnl,
      riskLevel: anomalies.riskLevel,
    },
  });
  
  return { state: buildState(store, userId), trade };
}

export function publishForUser(store: Store, userId: string, payload: {
  name: string; symbol: string; category: string; basePrice: number;
  volatility: number; creatorShare: number; supplyMode: 'limited' | 'unlimited'; supply: number;
}) {
  const before = buildState(store, userId);
  
  // Validate first
  const validation = validatePublish(before, payload);
  if (validation) {
    logAudit({
      userId,
      action: 'publish_failed',
      reason: validation.code,
      details: { code: validation.code, message: validation.message, payload },
    });
    return null;
  }
  
  const nextState = publishCard(before, payload);
  if (nextState === before) return null;
  persistProfileState(store, userId, nextState);
  
  // Audit successful publish
  const newCardId = nextState.market.cards.find(c => c.symbol === payload.symbol)?.id;
  logAudit({
    userId,
    action: 'publish',
    cardId: newCardId,
    details: {
      name: payload.name,
      symbol: payload.symbol,
      basePrice: payload.basePrice,
      supply: payload.supply,
      supplyMode: payload.supplyMode,
    },
  });
  
  return { state: buildState(store, userId) };
}

export function claimRewardForUser(store: Store, userId: string) {
  const before = buildState(store, userId);
  
  // Validate first
  const validation = validateRewardClaim(before);
  if (validation) {
    logAudit({
      userId,
      action: 'reward_rejected',
      reason: validation.code,
      details: { code: validation.code, message: validation.message },
    });
    return null;
  }
  
  const nextState = claimDailyReward(before);
  if (nextState === before) return null;
  persistProfileState(store, userId, nextState);
  
  // Audit successful reward claim
  logAudit({
    userId,
    action: 'claim_reward',
    details: {
      rewardAmount: nextState.player.cash - before.player.cash,
      streak: nextState.player.loginStreak,
    },
  });
  
  return { state: buildState(store, userId) };
}

export function buyRumorForUser(store: Store, userId: string) {
  const before = buildState(store, userId);
  
  if (before.player.cash < 500) {
    logAudit({
      userId,
      action: 'trade_rejected',
      reason: 'INSUFFICIENT_CASH',
      details: { message: 'Not enough cash for rumor' },
    });
    return null;
  }
  
  const nextState = buyRumor(before);
  if (nextState === before) return null;
  persistProfileState(store, userId, nextState);
  
  logAudit({
    userId,
    action: 'buy_rumor' as any,
    details: { cost: 500 },
  });
  
  return { state: buildState(store, userId) };
}

export function runAdCampaignForUser(store: Store, userId: string, cardId: string) {
  const before = buildState(store, userId);
  
  if (before.player.cash < 1000) {
    logAudit({
      userId,
      action: 'trade_rejected',
      reason: 'INSUFFICIENT_CASH',
      details: { message: 'Not enough cash for ad campaign' },
    });
    return null;
  }
  
  const nextState = runAdCampaign(before, cardId);
  if (nextState === before) return null;
  persistProfileState(store, userId, nextState);
  
  logAudit({
    userId,
    action: 'ad_campaign' as any,
    cardId,
    details: { cost: 1000 },
  });
  
  return { state: buildState(store, userId) };
}

export function advanceGlobalMarket(store: Store) {
  const syntheticState: GameState = { ...createInitialState(), market: store.market, log: [] };
  const nextState = advanceMarket(syntheticState);
  
  // Check for price spikes and activate circuit breakers
  for (const nextCard of nextState.market.cards) {
    const prevCard = store.market.cards.find(c => c.id === nextCard.id);
    if (prevCard) {
      const priceChange = Math.abs(nextCard.basePrice - prevCard.basePrice) / prevCard.basePrice;
      if (priceChange > 0.5) {
        // Price moved more than 50%
        activateCircuitBreaker(store, nextCard.id, `Price spike detected: ${Math.round(priceChange * 100)}% change`, 300_000);
        logAudit({
          action: 'circuit_breaker_activated' as any,
          cardId: nextCard.id,
          details: {
            reason: `Excessive price movement: ${Math.round(priceChange * 100)}%`,
            prevPrice: prevCard.basePrice,
            newPrice: nextCard.basePrice,
            durationMs: 300_000,
          },
        });
      }
    }
  }
  
  store.market = { ...nextState.market, leaderboard: [] };

  for (const user of store.users) {
    const profile = store.profiles[user.id];
    if (!profile) continue;
    profile.player = normalizePlayer({ ...profile.player, lastTickAt: Date.now() });
  }

  refreshLeaderboard(store);
}

export function resetUser(store: Store, userId: string) {
  store.profiles[userId] = createProfile();
  refreshLeaderboard(store);
  return buildState(store, userId);
}

export function computeNetWorth(store: Store, userId: string) {
  return Math.round(getNetWorth(buildState(store, userId)));
}
