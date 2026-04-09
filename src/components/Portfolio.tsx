import React from 'react';
import {
  type GameState,
  type CardDefinition,
  formatCurrency,
  getMarketPrice,
  getHoldingCount,
} from '../game';

type Props = {
  state: GameState;
  onSell: (cardId: string, qty: number) => void;
};

function PnlBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`pf-pnl ${pos ? 'pf-pnl-pos' : 'pf-pnl-neg'}`}>
      {pos ? '+' : ''}{formatCurrency(value)}
    </span>
  );
}

export default function Portfolio({ state, onSell }: Props) {
  const [sellQty, setSellQty] = React.useState<Record<string, number>>({});

  const holdings = state.market.cards
    .map(card => {
      const qty = getHoldingCount(state, card.id);
      if (qty === 0) return null;
      const price = getMarketPrice(card, state.market.tick, state.market.day);
      const avg = state.player.avgCost[card.id] ?? price;
      const pnl = Math.round((price - avg) * qty);
      const pnlPct = avg > 0 ? (price - avg) / avg : 0;
      return { card, qty, price, avg, pnl, pnlPct };
    })
    .filter(Boolean) as Array<{
      card: CardDefinition;
      qty: number;
      price: number;
      avg: number;
      pnl: number;
      pnlPct: number;
    }>;

  const totalInvested = holdings.reduce((s, h) => s + h.avg * h.qty, 0);
  const totalCurrentValue = holdings.reduce((s, h) => s + h.price * h.qty, 0);
  const totalPnl = Math.round(totalCurrentValue - totalInvested);
  const totalPnlPct = totalInvested > 0 ? totalPnl / totalInvested : 0;

  // Recent trades from log (approximate — server mode would pull /api/game/trades)
  const recentLogs = state.log.filter(l => l.includes('Bought') || l.includes('Sold')).slice(0, 8);

  return (
    <div className="pf-container">
      {/* Summary strip */}
      <div className="pf-summary">
        <div className="pf-summary-item">
          <span>Invested</span>
          <strong>{formatCurrency(totalInvested)}</strong>
        </div>
        <div className="pf-summary-item">
          <span>Current value</span>
          <strong>{formatCurrency(totalCurrentValue)}</strong>
        </div>
        <div className="pf-summary-item">
          <span>Unrealized P&L</span>
          <strong className={totalPnl >= 0 ? 'good' : 'bad'}>
            {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)} ({totalPnlPct >= 0 ? '+' : ''}{(totalPnlPct * 100).toFixed(1)}%)
          </strong>
        </div>
        <div className="pf-summary-item">
          <span>Cash</span>
          <strong>{formatCurrency(state.player.cash)}</strong>
        </div>
      </div>

      {/* Holdings */}
      {holdings.length === 0 ? (
        <div className="pf-empty">
          <span>🍌</span>
          <p>No positions yet. Head to the Market tab and buy your first card!</p>
        </div>
      ) : (
        <div className="pf-holdings">
          {holdings.map(({ card, qty, price, avg, pnl, pnlPct }) => {
            const cardSellQty = sellQty[card.id] ?? 1;
            return (
              <div key={card.id} className={`pf-holding-card ${pnl >= 0 ? 'pf-hold-green' : 'pf-hold-red'}`}>
                <div className="pf-hold-header">
                  <div>
                    <span className="pf-hold-symbol">{card.symbol}</span>
                    <span className="pf-hold-name">{card.name}</span>
                  </div>
                  <PnlBadge value={pnl} />
                </div>

                <div className="pf-hold-stats">
                  <div className="pf-stat">
                    <span>Held</span>
                    <strong>{qty}</strong>
                  </div>
                  <div className="pf-stat">
                    <span>Avg cost</span>
                    <strong>{formatCurrency(avg)}</strong>
                  </div>
                  <div className="pf-stat">
                    <span>Current</span>
                    <strong>{formatCurrency(price)}</strong>
                  </div>
                  <div className="pf-stat">
                    <span>Value</span>
                    <strong>{formatCurrency(price * qty)}</strong>
                  </div>
                </div>

                <div className="pf-hold-pnl-bar">
                  <div
                    className={`pf-hold-pnl-fill ${pnl >= 0 ? 'pf-fill-green' : 'pf-fill-red'}`}
                    style={{ width: `${Math.min(100, Math.abs(pnlPct) * 200)}%` }}
                  />
                </div>
                <div className="pf-hold-pct">
                  {pnlPct >= 0 ? '+' : ''}{(pnlPct * 100).toFixed(2)}% return
                </div>

                {/* Quick sell */}
                <div className="pf-hold-sell">
                  <div className="mc-qty-controls">
                    <button type="button" className="mc-qty-btn" onClick={() => setSellQty(s => ({ ...s, [card.id]: Math.max(1, (s[card.id] ?? 1) - 1) }))}>−</button>
                    <input
                      type="number" min={1} max={qty} value={cardSellQty}
                      onChange={e => setSellQty(s => ({ ...s, [card.id]: Math.max(1, Math.min(qty, parseInt(e.target.value) || 1)) }))}
                      className="mc-qty-input"
                    />
                    <button type="button" className="mc-qty-btn" onClick={() => setSellQty(s => ({ ...s, [card.id]: Math.min(qty, (s[card.id] ?? 1) + 1) }))}>+</button>
                  </div>
                  <button
                    type="button"
                    className="mc-execute-btn mc-sell-btn pf-sell-btn"
                    onClick={() => onSell(card.id, cardSellQty)}
                    id={`pf-sell-${card.id}`}
                  >
                    Sell {cardSellQty}×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Trade log */}
      {recentLogs.length > 0 && (
        <div className="pf-log">
          <p className="pf-log-title">Recent activity</p>
          {recentLogs.map((entry, i) => (
            <div key={i} className="pf-log-row">
              <span>{entry.includes('Bought') ? '🟢' : '🔴'}</span>
              <span>{entry}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
