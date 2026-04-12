import bcrypt from 'bcryptjs';
import { 
  buyForUser, 
  createUser, 
  getUserByEmail, 
  sellForUser,
  type Store 
} from './store';

export async function bootstrapBots(store: Store, commitCallback: () => Promise<void>) {
  const botProfiles = [
    { email: 'bot_momentum@ledger.io', name: 'Momentum Algo' },
    { email: 'bot_whale@ledger.io', name: 'Whale Entity' },
    { email: 'bot_retail@ledger.io', name: 'Retail Swarm' }
  ];

  const bots: string[] = [];

  for (const bp of botProfiles) {
    let u = getUserByEmail(store, bp.email);
    if (!u) {
      const ph = await bcrypt.hash('botpassword123_safeguard', 10);
      u = createUser(store, { email: bp.email, displayName: bp.name, passwordHash: ph });
      // Bots get a huge initial stash to play with
      const profile = store.profiles[u.id];
      if (profile) profile.player.cash = 100000;
    }
    bots.push(u.id);
  }
  
  // Persist the bot creation eagerly
  await commitCallback();

  // Start the heartbeat loop asynchronously
  runBotLoop(store, bots, commitCallback);
}

function runBotLoop(store: Store, bots: string[], commitCallback: () => Promise<void>) {
  setInterval(async () => {
    let mutated = false;
    
    // Pick a random bot to act this frame
    const botId = bots[Math.floor(Math.random() * bots.length)];
    const profile = store.profiles[botId];
    if (!profile) return;
    
    // Auto-replenish if bankrupt
    if (profile.player.cash < 500) {
      profile.player.cash += 50000;
    }

    const cards = store.market.cards;
    if (cards.length === 0) return;

    const actionRoll = Math.random();

    if (botId === bots[0]) {
      // Momentum Algo: Buy high-momentum trends, panic sell otherwise
      const highMo = cards.find(c => c.momentum > 0.15);
      if (highMo && actionRoll > 0.3) {
        if (buyForUser(store, botId, highMo.id, 5)) mutated = true;
      } else {
        const holdings = Object.keys(profile.player.holdings);
        if (holdings.length > 0) {
            const h = holdings[0];
            if (sellForUser(store, botId, h, Math.max(1, profile.player.holdings[h]))) mutated = true;
        }
      }
    } else if (botId === bots[1]) {
      // Whale Entity: Occasionally drops a massive nuke on an alt-card
      if (actionRoll > 0.85) { 
        // Focus on less owned cards to manipulate price
        const sorted = [...cards].sort((a,b) => a.owned - b.owned);
        const target = sorted[0];
        if (target && buyForUser(store, botId, target.id, 25)) mutated = true;
      }
    } else {
      // Retail Swarm: High frequency, low volume
      const rc = cards[Math.floor(Math.random() * cards.length)];
      if (actionRoll > 0.4) {
        if (buyForUser(store, botId, rc.id, 2)) mutated = true;
      } else {
        if (profile.player.holdings[rc.id] > 0) {
          if (sellForUser(store, botId, rc.id, profile.player.holdings[rc.id])) mutated = true;
        }
      }
    }

    if (mutated) {
      await commitCallback();
    }
  }, 8_000); // 8 seconds, creating aggressive action!
}
