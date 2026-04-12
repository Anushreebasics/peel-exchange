import React from 'react';
import {
  type SupplyMode,
  type GameState,
  buildCardDraftFromSeed,
  formatCurrency,
  getNetWorth,
} from '../game';

type Props = {
  state: GameState;
  onPublish: (payload: {
    name: string;
    symbol: string;
    category: string;
    basePrice: number;
    volatility: number;
    creatorShare: number;
    supplyMode: SupplyMode;
    supply: number;
  }) => void;
};

const CATEGORIES = ['Culture', 'Energy', 'AI', 'Logistics', 'Media', 'Finance', 'Gaming', 'Health', 'Infrastructure'];
const UNLOCK_THRESHOLD = 5000;

export default function CreatorStudio({ state, onPublish }: Props) {
  const netWorth = getNetWorth(state);
  const unlocked = netWorth >= UNLOCK_THRESHOLD;
  const progress = Math.min(100, (netWorth / UNLOCK_THRESHOLD) * 100);

  const [name, setName] = React.useState('');
  const [symbol, setSymbol] = React.useState('');
  const [category, setCategory] = React.useState('Culture');
  const [basePrice, setBasePrice] = React.useState(100);
  const [volatility, setVolatility] = React.useState(0.2);
  const [creatorShare, setCreatorShare] = React.useState(0.1);
  const [supplyMode, setSupplyMode] = React.useState<SupplyMode>('limited');
  const [supply, setSupply] = React.useState(500);
  const [seed, setSeed] = React.useState('wealth alpha');

  const draft = buildCardDraftFromSeed(seed);
  const displayName = name || draft.name;
  const displaySymbol = (symbol || draft.symbol).toUpperCase().slice(0, 5);
  const displayCategory = category || draft.category;

  // Estimated royalty at 100 trades/day
  const estimatedDailyRoyalty = Math.round(basePrice * creatorShare * 0.04 * 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlocked) return;
    onPublish({
      name: displayName,
      symbol: displaySymbol,
      category: displayCategory,
      basePrice,
      volatility,
      creatorShare,
      supplyMode,
      supply,
    });
  };

  const volatilityLabel = volatility < 0.15 ? 'Low — Stable, steady moves'
    : volatility < 0.25 ? 'Medium — Moderate swings'
    : volatility < 0.35 ? 'High — Wild price action'
    : 'Extreme — Rollercoaster';

  return (
    <div className="cs-container">
      {/* Unlock gate */}
      {!unlocked && (
        <div className="cs-gate">
          <div className="cs-gate-icon">LOCKED</div>
          <h3>Creator Studio Locked</h3>
          <p>Reach <strong>{formatCurrency(UNLOCK_THRESHOLD)}</strong> net worth to publish your own card to the market.</p>
          <div className="cs-gate-bar">
            <div className="cs-gate-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="cs-gate-progress">{formatCurrency(netWorth)} / {formatCurrency(UNLOCK_THRESHOLD)} ({progress.toFixed(1)}%)</p>
        </div>
      )}

      <div className={`cs-layout ${!unlocked ? 'cs-locked' : ''}`}>
        {/* Form */}
        <form className="cs-form" onSubmit={handleSubmit}>
          <div className="cs-section-title">Card Identity</div>

          <div className="cs-field-row">
            <label className="cs-label">
              Seed phrase
              <input value={seed} onChange={e => setSeed(e.target.value)} placeholder="wealth alpha" className="cs-input" />
              <small>Determines auto-generated defaults — or override below</small>
            </label>
          </div>

          <div className="cs-field-row cs-two-col">
            <label className="cs-label">
              Card name
              <input value={name} onChange={e => setName(e.target.value)} placeholder={draft.name} className="cs-input" />
            </label>
            <label className="cs-label">
              Ticker symbol
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                placeholder={draft.symbol}
                className="cs-input cs-mono"
              />
            </label>
          </div>

          <label className="cs-label">
            Category
            <select value={category} onChange={e => setCategory(e.target.value)} className="cs-select">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <div className="cs-section-title">Economics</div>

          <label className="cs-label">
            Starting price: <strong>{formatCurrency(basePrice)}</strong>
            <input type="range" min={20} max={2000} step={10} value={basePrice} onChange={e => setBasePrice(Number(e.target.value))} className="cs-slider" />
            <div className="cs-slider-labels"><span>$20</span><span>$2,000</span></div>
          </label>

          <label className="cs-label">
            Volatility: <strong>{volatilityLabel}</strong>
            <input type="range" min={0.05} max={0.55} step={0.01} value={volatility} onChange={e => setVolatility(Number(e.target.value))} className="cs-slider" />
            <div className="cs-slider-labels"><span>Stable</span><span>Extreme</span></div>
          </label>

          <label className="cs-label">
            Creator share: <strong>{Math.round(creatorShare * 100)}%</strong> of each trade fee
            <input type="range" min={0.02} max={0.4} step={0.01} value={creatorShare} onChange={e => setCreatorShare(Number(e.target.value))} className="cs-slider" />
            <div className="cs-slider-labels"><span>2%</span><span>40%</span></div>
          </label>
          <small className="cs-hint">Est. daily royalties at normal trading volume: <strong>{formatCurrency(estimatedDailyRoyalty)}</strong></small>

          <div className="cs-section-title">Supply Model</div>

          <div className="cs-supply-toggle">
            <button
              type="button"
              className={`cs-supply-btn ${supplyMode === 'limited' ? 'cs-supply-active' : ''}`}
              onClick={() => setSupplyMode('limited')}
            >
              Limited — Scarcity premium, early buyers win
            </button>
            <button
              type="button"
              className={`cs-supply-btn ${supplyMode === 'unlimited' ? 'cs-supply-active' : ''}`}
              onClick={() => setSupplyMode('unlimited')}
            >
              Unlimited — Like crypto, infinite supply
            </button>
          </div>

          {supplyMode === 'limited' && (
            <label className="cs-label">
              Total supply cap: <strong>{supply.toLocaleString()} cards</strong>
              <input type="range" min={50} max={10000} step={50} value={supply} onChange={e => setSupply(Number(e.target.value))} className="cs-slider" />
              <div className="cs-slider-labels"><span>50</span><span>10,000</span></div>
            </label>
          )}

          <button
            type="submit"
            className={`cs-publish-btn ${unlocked ? '' : 'cs-publish-locked'}`}
            disabled={!unlocked}
            id="creator-publish-btn"
          >
            {unlocked ? `Publish ${displaySymbol} to Yellow Ledger` : 'Locked: Need $5,000 net worth'}
          </button>
        </form>

        {/* Live card preview */}
        <div className="cs-preview-col">
          <p className="cs-preview-label">Live preview</p>
          <div className="cs-card-preview">
            <div className="cs-preview-shine" />
            <div className="cs-preview-top">
              <span className="cs-preview-symbol">{displaySymbol}</span>
              <span className="cs-preview-category">{displayCategory}</span>
            </div>
            <h3 className="cs-preview-name">{displayName}</h3>
            <div className="cs-preview-price">
              <span>Starting price</span>
              <strong>{formatCurrency(basePrice)}</strong>
            </div>
            <div className="cs-preview-bars">
              <div className="cs-preview-bar-row">
                <span>Volatility</span>
                <div className="cs-preview-bar">
                  <div className="cs-preview-bar-fill cs-bar-vol" style={{ width: `${(volatility / 0.55) * 100}%` }} />
                </div>
              </div>
              <div className="cs-preview-bar-row">
                <span>Creator %</span>
                <div className="cs-preview-bar">
                  <div className="cs-preview-bar-fill cs-bar-share" style={{ width: `${(creatorShare / 0.4) * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="cs-preview-footer">
              <span className={`cs-supply-badge ${supplyMode === 'limited' ? 'cs-supply-limited' : 'cs-supply-unlimited'}`}>
                {supplyMode === 'limited' ? `${supply.toLocaleString()} max` : '∞ unlimited'}
              </span>
              <span className="cs-preview-royalty">~{formatCurrency(estimatedDailyRoyalty)}/day royalty</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
