import { prisma } from './prisma.js';
import { getMarketPrice } from '../src/game.js';
import { buyForUser, sellForUser, type Store } from './store.js';

export async function processLimitOrders(store: Store, commitCallback: () => Promise<void>) {
  const openOrders = await prisma.order.findMany({
    where: { status: 'open' }
  });

  if (openOrders.length === 0) return;

  let mutated = false;
  const cards = store.market.cards;
  const tick = store.market.tick;
  const day = store.market.day;

  for (const order of openOrders) {
    const card = cards.find(c => c.id === order.cardId);
    if (!card) continue;

    const currentPrice = getMarketPrice(card as any, tick, day);

    let executed = false;
    
    // Check if the spread overlaps to trigger a fill
    if (order.side === 'buy' && currentPrice <= order.targetPrice) {
      const result = buyForUser(store, order.userId, card.id, order.quantity);
      if (result) executed = true;
    } else if (order.side === 'sell' && currentPrice >= order.targetPrice) {
      const result = sellForUser(store, order.userId, card.id, order.quantity);
      if (result) executed = true;
    }

    if (executed) {
      // Mark as filled
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'filled' }
      });
      mutated = true;
    }
  }

  if (mutated) {
    // Notify clients of market ticks created by filled limit orders
    await commitCallback();
  }
}
