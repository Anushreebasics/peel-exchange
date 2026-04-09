import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { resolve } from 'path';
import {
  advanceGlobalMarket,
  buyForUser,
  claimRewardForUser,
  computeNetWorth,
  createUser,
  detectAnomalies,
  getAuditLog,
  getEvents,
  getGameState,
  getLeaderboard,
  getNews,
  getPortfolio,
  getTrades,
  getUser,
  getUserByEmail,
  isCircuitBreakerActive,
  loadStore,
  publishForUser,
  resetUser,
  saveStore,
  sellForUser,
  touchLogin,
  type AnomalyFlags,
  type CircuitBreakerState,
  type StoredUser,
  type Store,
  type ValidationError,
} from './store';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET ?? 'banana-trading-company-dev-secret';
const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

const store: Store = await loadStore();

function signToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

function userFromToken(token?: string) {
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) {
      return null;
    }
    return getUser(store, userId);
  } catch {
    return null;
  }
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const user = userFromToken(token);

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  (req as express.Request & { user: StoredUser }).user = user;
  next();
}

function publicUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

async function commitStore() {
  store.market.leaderboard = getLeaderboard(store);
  await saveStore(store);
}

function serializeState(userId: string) {
  return getGameState(store, userId);
}

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(24).optional(),
});

const cardActionSchema = z.object({
  cardId: z.string().min(1),
  quantity: z.number().int().positive().max(1000).default(1),
});

const publishSchema = z.object({
  name: z.string().min(2).max(40),
  symbol: z.string().min(2).max(6),
  category: z.string().min(2).max(32),
  basePrice: z.number().int().min(10).max(5000),
  volatility: z.number().min(0.05).max(1),
  creatorShare: z.number().min(0.02).max(0.4),
  supplyMode: z.enum(['limited', 'unlimited']),
  supply: z.number().int().min(1).max(10000),
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, users: store.users.length, marketTick: store.market.tick });
});

app.post('/api/auth/signup', async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid signup data' });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  if (getUserByEmail(store, email)) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = createUser(store, {
    email,
    passwordHash,
    displayName: parsed.data.displayName?.trim() || email.split('@')[0],
  });

  const token = signToken(user.id);
  await commitStore();
  res.status(201).json({ token, user: publicUser(user), state: serializeState(user.id) });
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid login data' });
    return;
  }

  const user = getUserByEmail(store, parsed.data.email);
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  touchLogin(store, user.id);
  const token = signToken(user.id);
  await commitStore();
  res.json({ token, user: publicUser(user), state: serializeState(user.id) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  res.json({ user: publicUser(user), state: serializeState(user.id) });
});

app.get('/api/game/state', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  res.json({ state: serializeState(user.id), user: publicUser(user) });
});

app.get('/api/game/portfolio', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  res.json({ portfolio: getPortfolio(store, user.id) });
});

app.get('/api/game/trades', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  res.json({ trades: getTrades(store, user.id) });
});

app.get('/api/game/news', (_req, res) => {
  res.json({ news: getNews(store), events: getEvents(store) });
});

app.get('/api/game/leaderboard', (_req, res) => {
  res.json({ leaderboard: getLeaderboard(store) });
});

app.post('/api/game/buy', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const parsed = cardActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid buy payload' });
    return;
  }

  const result = buyForUser(store, user.id, parsed.data.cardId, parsed.data.quantity);
  if (!result) {
    res.status(400).json({ error: 'Trade rejected' });
    return;
  }

  await commitStore();
  res.json({ state: result.state, trade: result.trade });
});

app.post('/api/game/sell', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const parsed = cardActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid sell payload' });
    return;
  }

  const result = sellForUser(store, user.id, parsed.data.cardId, parsed.data.quantity);
  if (!result) {
    res.status(400).json({ error: 'Trade rejected' });
    return;
  }

  await commitStore();
  res.json({ state: result.state, trade: result.trade });
});

app.post('/api/game/publish', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid card payload' });
    return;
  }

  const result = publishForUser(store, user.id, parsed.data);
  if (!result) {
    res.status(400).json({ error: 'Publishing denied' });
    return;
  }

  await commitStore();
  res.json({ state: result.state });
});

app.post('/api/game/reward/daily', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const result = claimRewardForUser(store, user.id);
  if (!result) {
    res.status(400).json({ error: 'Daily reward already claimed' });
    return;
  }

  await commitStore();
  res.json({ state: result.state });
});

app.post('/api/game/advance', requireAuth, async (req, res) => {
  advanceGlobalMarket(store);
  await commitStore();
  const user = (req as express.Request & { user: StoredUser }).user;
  res.json({ state: serializeState(user.id) });
});

app.post('/api/game/reset', requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const state = resetUser(store, user.id);
  await commitStore();
  res.json({ state });
});

app.get('/api/game/summary', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const state = serializeState(user.id);
  res.json({
    netWorth: computeNetWorth(store, user.id),
    holdings: Object.entries(state.player.holdings).length,
    cash: state.player.cash,
    level: state.player.level,
  });
});

// ── Debug Endpoints (for development/debugging) ──────────────────────
app.get('/api/debug/audit', requireAuth, (req, res) => {
  // Optional: restrict to admins. For now, audit access is available to authenticated users.
  const audit = getAuditLog();
  res.json({ audit });
});

app.get('/api/debug/anomalies', requireAuth, (req, res) => {
  const user = (req as express.Request & { user: StoredUser }).user;
  const userAnomalies = Object.entries(store.anomalyFlags)
    .filter(([key]) => key.startsWith(`${user.id}:`))
    .map(([key, flags]) => ({
      cardId: key.split(':')[1],
      ...flags,
    }));
  res.json({ anomalies: userAnomalies });
});

app.get('/api/debug/circuit-breakers', requireAuth, (req, res) => {
  const activeBreakers = Object.values(store.circuitBreakers).filter(cb => cb.isBroken);
  res.json({ circuitBreakers: activeBreakers });
});

if (process.env.NODE_ENV === 'production') {
  const clientDist = resolve(process.cwd(), 'dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
  });
}

const server = app.listen(PORT, () => {
  console.log(`Banana Trading Company API listening on http://localhost:${PORT}`);
});

setInterval(async () => {
  advanceGlobalMarket(store);
  await saveStore(store);
}, 45_000);

process.on('SIGINT', async () => {
  await saveStore(store);
  server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
  await saveStore(store);
  server.close(() => process.exit(0));
});
