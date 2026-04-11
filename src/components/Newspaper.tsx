import { type NewsItem, type MarketState, formatPercent } from '../game';

type Props = {
  news: NewsItem[];
  market: MarketState;
  rumors?: string[];
  onBuyRumor?: () => void;
  cash?: number;
};

function moodEmoji(mood: NewsItem['mood']) {
  if (mood === 'positive') return '📈';
  if (mood === 'negative') return '📉';
  return '📊';
}

function moodLabel(mood: NewsItem['mood']) {
  if (mood === 'positive') return 'BULLISH';
  if (mood === 'negative') return 'BEARISH';
  return 'NEUTRAL';
}

function MarketWeather({ market }: { market: MarketState }) {
  const prices = market.cards.map(c => {
    const history = c.priceHistory ?? [];
    if (history.length < 2) return 0;
    return (history[history.length - 1] - history[0]) / history[0];
  });
  const bullish = prices.filter(p => p > 0).length;
  const total = prices.length || 1;
  const sentiment = bullish / total;

  let icon = '☀️';
  let label = 'Sunny — Strong bull market';
  if (sentiment < 0.3) { icon = '⛈️'; label = 'Storm — Strong bear market'; }
  else if (sentiment < 0.5) { icon = '🌧️'; label = 'Overcast — Bearish lean'; }
  else if (sentiment < 0.65) { icon = '⛅'; label = 'Partly cloudy — Mixed signals'; }

  return (
    <div className="np-weather">
      <span className="np-weather-icon">{icon}</span>
      <div>
        <p className="np-weather-label">{label}</p>
        <p className="np-weather-sub">{bullish}/{total} cards trending up · Day {market.day} · Tick {market.tick}</p>
      </div>
    </div>
  );
}

export default function Newspaper({ news, market, rumors, onBuyRumor, cash }: Props) {
  const [lead, ...rest] = news;

  return (
    <div className="np-wrapper">
      {/* Masthead */}
      <div className="np-masthead">
        <div className="np-masthead-left">
          <p className="np-edition">The Daily Peel · Day {market.day} · Tick {market.tick}</p>
          <h2 className="np-title">Banana Times</h2>
          <p className="np-tagline">"All the news that moves markets"</p>
        </div>
        <MarketWeather market={market} />
      </div>

      {/* Rumor Mill */}
      {onBuyRumor && rumors !== undefined && cash !== undefined && (
        <div className="np-rumor-mill" style={{ background: 'var(--surface-sunken)', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.2rem', color: 'var(--text-strong)' }}>🕵️ The Rumor Mill</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--text-muted)' }}>Pay insiders $500 for a hint about upcoming market events.</p>
          <button 
            type="button" 
            onClick={onBuyRumor} 
            disabled={cash < 500}
            className="mc-execute-btn mc-buy-btn"
            style={{ width: 'max-content', padding: '8px 16px', fontSize: '0.9rem', marginBottom: '16px' }}
          >
            Buy Tip ($500)
          </button>
          
          {rumors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Past Rumors</p>
              {rumors.slice(0, 3).map((r, i) => (
                <div key={i} style={{ background: 'var(--surface)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid var(--brand-purple)', fontSize: '0.95rem' }}>
                  "{r}"
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lead story */}
      {lead && (
        <div className={`np-lead np-lead-${lead.mood}`}>
          <div className="np-lead-badge">
            {moodEmoji(lead.mood)} {moodLabel(lead.mood)}
          </div>
          <h3 className="np-lead-headline">{lead.title}</h3>
          <p className="np-lead-body">{lead.body}</p>
          <div className="np-lead-impact">
            {lead.cardSymbol && <span className="np-card-tag">{lead.cardSymbol}</span>}
            {lead.priceDelta !== undefined && (
              <span className={`np-delta ${lead.priceDelta >= 0 ? 'good' : 'bad'}`}>
                {formatPercent(lead.priceDelta)} move
              </span>
            )}
            <span className="np-impact-text">{lead.impact}</span>
          </div>
        </div>
      )}

      {/* Column stories */}
      {rest.length > 0 && (
        <div className="np-columns">
          {rest.map((item) => (
            <article key={item.id} className={`np-article np-article-${item.mood}`}>
              <div className="np-article-badge">{moodEmoji(item.mood)}</div>
              <h4 className="np-article-headline">{item.title}</h4>
              <p className="np-article-body">{item.body}</p>
              <div className="np-article-footer">
                {item.cardSymbol && <span className="np-card-tag">{item.cardSymbol}</span>}
                <span className="np-impact-text">{item.impact}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Live ticker */}
      <div className="np-cards-ticker">
        <span className="np-ticker-label">LIVE</span>
        <div className="np-ticker-track">
          {[...market.cards, ...market.cards].map((card, i) => {
            const history = card.priceHistory ?? [];
            const prev = history.length >= 2 ? history[history.length - 2] : null;
            const curr = history.length >= 1 ? history[history.length - 1] : null;
            const up = curr !== null && prev !== null ? curr >= prev : true;
            return (
              <span key={`${card.id}-${i}`} className={`np-ticker-item ${up ? 'good' : 'bad'}`}>
                {card.symbol} {curr ? `$${curr}` : '—'} {up ? '▲' : '▼'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
