import React from 'react';
import {
  type CardDefinition,
  type GameState,
  formatCurrency,
  formatPercent,
  getBuyCost,
  getSellProceeds,
  getHoldingCount,
  getMarketPrice,
} from '../game';

type Props = {
  card: CardDefinition;
  state: GameState;
  onBuy: (cardId: string, qty: number) => void;
  onSell: (cardId: string, qty: number) => void;
  onOrder?: (cardId: string, side: 'buy'|'sell', targetPrice: number, qty: number) => void;
};

function Sparkline({ prices, positive }: { prices: number[]; positive: boolean }) {
  if (prices.length < 2) {
    return <div className="sparkline sparkline-empty" />;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const w = 100;
  const h = 32;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x},${y}`;
  });
  const color = positive ? '#1f7a4c' : '#a94545';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline" preserveAspectRatio="none">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points={`0,${h} ${pts.join(' ')} ${w},${h}`}
        fill={positive ? 'rgba(31,122,76,0.12)' : 'rgba(169,69,69,0.12)'}
        stroke="none"
      />
    </svg>
  );
}

export default function MarketCard({ card, state, onBuy, onSell, onOrder }: Props) {
  const [qty, setQty] = React.useState(1);
  const [tab, setTab] = React.useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = React.useState<'market' | 'limit'>('market');
  const [targetPrice, setTargetPrice] = React.useState<number>(card.basePrice);

  const price = getMarketPrice(card, state.market.tick, state.market.day);
  const holding = getHoldingCount(state, card.id);
  const prices = card.priceHistory ?? [];
  const prevPrice = prices.length >= 2 ? prices[prices.length - 2] : price;
  const delta = price - prevPrice;
  const deltaFrac = prevPrice > 0 ? delta / prevPrice : 0;
  const positive = delta >= 0;

  const buyCost = getBuyCost(state, card.id, qty);
  const sellProceeds = getSellProceeds(state, card.id, qty);
  const canBuy = buyCost <= state.player.cash;
  const canSell = holding >= qty;

  const supplyRatio = card.supplyMode === 'limited' && card.supply > 0
    ? card.owned / card.supply
    : null;

  const avgCost = state.player.avgCost[card.id] ?? 0;
  const pnlPerUnit = holding > 0 && avgCost > 0 ? price - avgCost : 0;
  const pnlTotal = Math.round(pnlPerUnit * holding);
  const pnlPositive = pnlTotal >= 0;

  const momentumAbs = Math.abs(card.momentum ?? 0);
  const hasMomentum = momentumAbs > 0.03;
  const momentumDir = (card.momentum ?? 0) >= 0 ? '▲' : '▼';
  const momentumColor = (card.momentum ?? 0) >= 0 ? 'good' : 'bad';

  return (
    <article className={`market-card ${positive ? 'card-up' : 'card-down'}`} id={`card-${card.id}`}>
      {/* Header */}
      <div className="mc-header">
        <div className="mc-symbol-row">
          <span className="mc-symbol">{card.symbol}</span>
          {hasMomentum && (
            <span className={`mc-momentum ${momentumColor}`}>
              {momentumDir} {formatPercent(card.momentum ?? 0)} momentum
            </span>
          )}
        </div>
        <div className="mc-price-row">
          <strong className="mc-price">{formatCurrency(price)}</strong>
          <span className={`mc-delta ${positive ? 'good' : 'bad'}`}>
            {delta >= 0 ? '+' : ''}{formatCurrency(delta)} ({formatPercent(deltaFrac)})
          </span>
        </div>
        <p className="mc-name">{card.name}</p>
        <p className="mc-meta">{card.category} · {card.supplyMode === 'limited' ? 'Limited' : 'Unlimited'} supply · {Math.round(card.creatorShare * 100)}% creator</p>
      </div>

      {/* Sparkline */}
      <div className="mc-chart">
        <Sparkline prices={prices} positive={positive} />
      </div>

      {/* Supply bar for limited cards */}
      {supplyRatio !== null && (
        <div className="mc-supply">
          <div className="mc-supply-bar">
            <div className="mc-supply-fill" style={{ width: `${Math.min(100, supplyRatio * 100)}%` }} />
          </div>
          <span className="mc-supply-label">{card.owned}/{card.supply} minted · {Math.round(supplyRatio * 100)}% sold</span>
        </div>
      )}

      {/* Holdings P&L */}
      {holding > 0 && (
        <div className={`mc-holding ${pnlPositive ? 'mc-holding-green' : 'mc-holding-red'}`}>
          <span>Holding {holding} · Avg {formatCurrency(avgCost)}</span>
          <span className={pnlPositive ? 'good' : 'bad'}>
            {pnlPositive ? '+' : ''}{formatCurrency(pnlTotal)} P&L
          </span>
        </div>
      )}

      {/* Trade controls */}
      <div className="mc-trade">
        <div className="mc-tabs">
          <button
            type="button"
            className={`mc-tab ${tab === 'buy' ? 'mc-tab-active' : ''}`}
            onClick={() => { setTab('buy'); setTargetPrice(Math.round(price)); }}
          >
            Buy
          </button>
          <button
            type="button"
            className={`mc-tab ${tab === 'sell' ? 'mc-tab-active' : ''}`}
            onClick={() => { setTab('sell'); setTargetPrice(Math.round(price)); }}
          >
            Sell
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', fontSize: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={orderType === 'limit'} onChange={e => setOrderType(e.target.checked ? 'limit' : 'market')} style={{ marginRight: '6px' }} />
            Limit Order
          </label>
        </div>

        <div className="mc-qty-row">
          <label className="mc-qty-label" htmlFor={`qty-${card.id}`}>Qty</label>
          <div className="mc-qty-controls">
            <button type="button" className="mc-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <input
              id={`qty-${card.id}`}
              type="number"
              min={1}
              max={100}
              value={qty}
              onChange={e => setQty(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              className="mc-qty-input"
            />
            <button type="button" className="mc-qty-btn" onClick={() => setQty(q => Math.min(100, q + 1))}>+</button>
          </div>
        </div>

        {orderType === 'limit' && (
          <div className="mc-qty-row">
            <label className="mc-qty-label">Target $</label>
            <input 
              type="number" 
              value={targetPrice} 
              onChange={e => setTargetPrice(parseInt(e.target.value) || 0)} 
              className="mc-qty-input" 
              style={{ padding: '6px' }} 
            />
          </div>
        )}

        {tab === 'buy' ? (
          <div className="mc-action">
            <div className="mc-cost-preview">
              {orderType === 'limit' ? `Total Allocation: ` : `Cost: `} 
              <strong>{formatCurrency(orderType === 'limit' ? targetPrice * qty : buyCost)}</strong>
            </div>
            <button
              type="button"
              className="mc-execute-btn mc-buy-btn"
              disabled={orderType === 'limit' ? state.player.cash < (targetPrice * qty) : !canBuy}
              onClick={() => orderType === 'limit' && onOrder ? onOrder(card.id, 'buy', targetPrice, qty) : onBuy(card.id, qty)}
              id={`buy-${card.id}`}
            >
              {orderType === 'limit' ? 'Place Buy Order' : `Buy ${qty}× ${card.symbol}`}
            </button>
            {orderType !== 'limit' && !canBuy && <span className="mc-warn">Insufficient funds</span>}
            {orderType === 'limit' && state.player.cash < (targetPrice * qty) && <span className="mc-warn">Insufficient funds for order</span>}
          </div>
        ) : (
          <div className="mc-action">
            <div className="mc-cost-preview">
              {orderType === 'limit' ? `Target Proceeds: ` : `Proceeds: `} 
              <strong>{formatCurrency(orderType === 'limit' ? targetPrice * qty : sellProceeds)}</strong>
            </div>
            <button
              type="button"
              className="mc-execute-btn mc-sell-btn"
              disabled={!canSell}
              onClick={() => orderType === 'limit' && onOrder ? onOrder(card.id, 'sell', targetPrice, qty) : onSell(card.id, qty)}
              id={`sell-${card.id}`}
            >
              {orderType === 'limit' ? 'Place Sell Order' : `Sell ${qty}× ${card.symbol}`}
            </button>
            {!canSell && <span className="mc-warn">Only {holding} held</span>}
          </div>
        )}
      </div>
    </article>
  );
}
