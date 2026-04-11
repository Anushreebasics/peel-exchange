import { readFile } from 'fs/promises';
import path from 'path';
import { prisma } from './prisma.js';

async function migrate() {
  const storePath = path.join(process.cwd(), 'server', 'data', 'store.json');
  
  console.log('Reading store.json...');
  let store: any;
  try {
    const raw = await readFile(storePath, 'utf8');
    store = JSON.parse(raw);
  } catch (err) {
    console.log('No store.json found, skipping migration.');
    return;
  }

  console.log(`Found ${store.users?.length ?? 0} users in store.json. Migrating...`);

  // Clear existing DB
  await prisma.auditEntry.deleteMany();
  await prisma.anomalyFlag.deleteMany();
  await prisma.circuitBreaker.deleteMany();
  await prisma.marketEvent.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.card.deleteMany();
  await prisma.user.deleteMany();
  await prisma.globalState.deleteMany();

  // 1. Global State
  if (store.market) {
    await prisma.globalState.create({
      data: {
        id: 1,
        day: store.market.day,
        tick: store.market.tick,
        news: JSON.stringify(store.market.news || []),
      }
    });

    // Cards
    console.log(`Migrating ${store.market.cards?.length ?? 0} cards...`);
    for (const card of store.market.cards || []) {
      await prisma.card.create({
        data: {
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
          momentum: card.momentum || 0,
          priceHistory: JSON.stringify(card.priceHistory || []),
          publishedByPlayer: card.publishedByPlayer || false,
          publisherId: card.publisherId,
        }
      });
    }
  }

  // 2. Users and Profiles
  for (const user of store.users || []) {
    const profile = store.profiles[user.id];
    if (!profile) continue;

    console.log(`Migrating user ${user.displayName}...`);

    await prisma.user.create({
      data: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        displayName: user.displayName,
        createdAt: new Date(user.createdAt),
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
        
        cash: profile.player.cash,
        xp: profile.player.xp,
        level: profile.player.level,
        creatorWallet: profile.player.creatorWallet || 0,
        lastDailyRewardAt: profile.player.lastDailyRewardAt ? new Date(profile.player.lastDailyRewardAt) : null,
        lastLoginDate: profile.player.lastLoginDate,
        loginStreak: profile.player.loginStreak,
        lastTickAt: new Date(profile.player.lastTickAt || Date.now()),
        rumors: JSON.stringify(profile.player.rumors || []),
      }
    });

    // Holdings
    for (const [cardId, qty] of Object.entries(profile.player.holdings || {})) {
      if ((qty as number) > 0) {
        await prisma.holding.create({
          data: {
            userId: user.id,
            cardId,
            qty: qty as number,
            avgCost: profile.player.avgCost[cardId] || 0,
          }
        });
      }
    }

    // Trades
    for (const trade of profile.trades || []) {
      await prisma.trade.create({
        data: {
          id: trade.id,
          userId: user.id,
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

  console.log('Migration complete!');
}

migrate()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
