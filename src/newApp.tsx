import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  advanceMarket,
  buyCard,
  buyRumor,
  claimDailyReward,
  createInitialState,
  formatCurrency,
  getMarketPrice,
  getNetWorth,
  getProgression,
  loadState,
  publishCard,
  runAdCampaign,
  saveState,
  sellCard,
  type GameState,
  type SupplyMode,
} from './game';
import {
  advanceMarket as apiAdvanceMarket,
  buyCard as apiBuyCard,
  buyRumor as apiBuyRumor,
  claimDailyReward as apiClaimDailyReward,
  clearStoredToken,
  getCurrentSession,
  getStoredToken,
  logIn,
  publishCard as apiPublishCard,
  resetGame as apiResetGame,
  runAdCampaign as apiRunAdCampaign,
  setStoredToken,
  signUp,
  sellCard as apiSellCard,
  type ApiUser,
  placeLimitOrder,
} from './lib/api';
import { io, Socket } from 'socket.io-client';
import MarketCard from './components/MarketCard';
import Leaderboard from './components/Leaderboard';
import Newspaper from './components/Newspaper';
import Portfolio from './components/Portfolio';
import CreatorStudio from './components/CreatorStudio';
import ToastContainer, { type ToastData } from './components/Toast';

type PageId = 'market' | 'portfolio' | 'creator' | 'leaderboard' | 'news';
type AuthFormState = { displayName: string; email: string; password: string };

const pages: Array<{ id: PageId; label: string; icon: string }> = [
  { id: 'market',      label: 'Market',      icon: '📈' },
  { id: 'portfolio',   label: 'Portfolio',   icon: '💼' },
  { id: 'creator',     label: 'Creator',     icon: '🚀' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
  { id: 'news',        label: 'News',        icon: '📰' },
];

const onboardingStorageKey = 'yellow-ledger-onboarding-v1';

let toastCounter = 0;

// ── Auth Modal ─────────────────────────────────────────────────────────────
function AuthModal({
  onClose, onSuccess,
}: {
  onClose: () => void;
  onSuccess: (user: ApiUser, state: GameState) => void;
}) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState<AuthFormState>({ displayName: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = tab === 'signup'
        ? await signUp(form)
        : await logIn({ email: form.email, password: form.password });
      setStoredToken(response.token);
      onSuccess(response.user, response.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-header">
          <span className="modal-banana">🏦</span>
          <h2 className="modal-title">Yellow Ledger</h2>
          <p className="modal-sub">Sign in to save your progress and appear on the leaderboard</p>
        </div>

        <div className="modal-tabs">
          <button type="button" className={`modal-tab ${tab === 'login' ? 'modal-tab-active' : ''}`} onClick={() => setTab('login')}>Log in</button>
          <button type="button" className={`modal-tab ${tab === 'signup' ? 'modal-tab-active' : ''}`} onClick={() => setTab('signup')}>Create account</button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          {tab === 'signup' && (
            <div className="modal-field">
              <label htmlFor="modal-name">Display name</label>
              <input id="modal-name" type="text" placeholder="Banana Ace" value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} required />
            </div>
          )}
          <div className="modal-field">
            <label htmlFor="modal-email">Email</label>
            <input id="modal-email" type="email" placeholder="you@example.com" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="modal-field">
            <label htmlFor="modal-password">Password</label>
            <input id="modal-password" type="password" placeholder="At least 8 characters" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
          </div>
          {error && <p className="modal-error">{error}</p>}
          <button type="submit" className="modal-submit" disabled={loading} id="auth-submit-btn">
            {loading ? <span className="modal-spinner" /> : (tab === 'login' ? 'Log in' : 'Create account')}
          </button>
        </form>

        <p className="modal-guest-note">Playing as guest? Your progress is saved locally until you sign up.</p>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const [state, setState] = useState<GameState>(loadState);
  const [activePage, setActivePage] = useState<PageId>('market');
  const [authUser, setAuthUser] = useState<ApiUser | null>(null);
  const [authMode, setAuthMode] = useState<'guest' | 'server'>('guest');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(onboardingStorageKey) !== 'dismissed';
  });

  const addToast = useCallback((message: string, type: ToastData['type'] = 'info') => {
    const id = `toast-${++toastCounter}`;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Auth hydration on load
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    let mounted = true;
    getCurrentSession()
      .then(r => {
        if (!mounted) return;
        setState(r.state);
        setAuthUser(r.user);
        setAuthMode('server');
      })
      .catch(() => clearStoredToken());
    return () => { mounted = false; };
  }, []);

  // Guest save
  useEffect(() => {
    if (authMode === 'guest') saveState(state);
  }, [authMode, state]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(onboardingStorageKey, showOnboarding ? 'visible' : 'dismissed');
  }, [showOnboarding]);

  // Auto market tick (Guest) or Live Streaming (Server)
  useEffect(() => {
    let socket: Socket | null = null;
    let t: number | undefined;

    if (authMode === 'guest') {
      t = window.setInterval(() => setState(s => {
        const next = advanceMarket(s);
        saveState(next);
        return next;
      }), 5000);
    } else {
      socket = io('/', { path: '/socket.io' });
      socket.on('market_update', (data: any) => {
        setState(prev => {
          if (!prev) return prev;
          return { ...prev, market: data.market };
        });
      });
    }

    return () => {
      if (t !== undefined) window.clearInterval(t);
      if (socket) socket.disconnect();
    };
  }, [authMode]);

  const progression = useMemo(() => getProgression(state), [state]);
  const netWorth    = useMemo(() => getNetWorth(state),    [state]);

  const marketPulse = state.market.cards.reduce(
    (sum, card) => sum + (getMarketPrice(card, state.market.tick, state.market.day) - card.basePrice), 0,
  );

  const applyState = (next: GameState) => {
    setState(next);
    if (authMode === 'guest') saveState(next);
  };

  const mutate = async (local: () => GameState, remote: () => Promise<{ state: GameState }>) => {
    if (authMode === 'server') { const r = await remote(); setState(r.state); return; }
    applyState(local());
  };

  const handleBuy = async (cardId: string, qty: number) => {
    const card = state.market.cards.find(c => c.id === cardId);
    await mutate(() => buyCard(state, cardId, qty), () => apiBuyCard(cardId, qty));
    addToast(`Bought ${qty}× ${card?.symbol ?? cardId}`, 'buy');
  };

  const handleSell = async (cardId: string, qty: number) => {
    const card = state.market.cards.find(c => c.id === cardId);
    await mutate(() => sellCard(state, cardId, qty), () => apiSellCard(cardId, qty));
    addToast(`Sold ${qty}× ${card?.symbol ?? cardId}`, 'sell');
  };

  const handleOrder = async (cardId: string, side: 'buy'|'sell', targetPrice: number, qty: number) => {
    if (authMode !== 'server') {
      addToast('Limit Orders require an authenticated session!', 'error');
      setShowAuthModal(true);
      return;
    }
    try {
      await placeLimitOrder(cardId, side, targetPrice, qty);
      addToast(`Placed open ${side} limit order for ${qty}× at ${formatCurrency(targetPrice)}`, 'info');
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleClaimReward = async () => {
    await mutate(() => claimDailyReward(state), () => apiClaimDailyReward());
    addToast('Daily reward claimed! 🎁', 'reward');
  };

  const handleBuyRumor = async () => {
    await mutate(() => buyRumor(state), () => apiBuyRumor());
    addToast('You bought an insider rumor! 🕵️', 'info');
  };

  const handleRunAdCampaign = async (cardId: string) => {
    await mutate(() => runAdCampaign(state, cardId), () => apiRunAdCampaign(cardId));
    addToast('Ad campaign launched! 📈', 'info');
  };

  const onboarding = useMemo(() => {
    const hasHoldings = Object.values(state.player.holdings).some(qty => qty > 0);
    const creatorUnlocked = netWorth >= 5000;
    const dailyReady = progression.dailyReady;
    const signedIn = authMode === 'server';

    return [
      {
        id: 'trade',
        label: 'Make your first trade',
        done: hasHoldings,
        detail: hasHoldings ? 'You already own inventory. Move to Portfolio to manage it.' : 'Buy any card to get market exposure and start the loop.',
        action: 'Go to Market',
        onAction: () => setActivePage('market'),
      },
      {
        id: 'reward',
        label: 'Claim your daily reward',
        done: !dailyReady,
        detail: dailyReady ? 'A reward is ready now. Claim it from the top bar for free cash.' : 'Reward already claimed. Come back tomorrow for more.',
        action: dailyReady ? 'Claim reward' : 'Reward claimed',
        onAction: dailyReady ? handleClaimReward : undefined,
      },
      {
        id: 'creator',
        label: 'Unlock Creator Studio',
        done: creatorUnlocked,
        detail: creatorUnlocked ? 'You can publish your own card now.' : 'Reach $5,000 net worth to publish a card with royalties.',
        action: 'Open Creator',
        onAction: () => setActivePage('creator'),
      },
      {
        id: 'save',
        label: 'Save progress online',
        done: signedIn,
        detail: signedIn ? `Signed in as ${authUser?.displayName ?? 'a player'}.` : 'Sign in so your run follows you across devices.',
        action: signedIn ? 'Saved' : 'Sign in',
        onAction: signedIn ? undefined : () => setShowAuthModal(true),
      },
    ];
  }, [authMode, authUser?.displayName, netWorth, progression.dailyReady, handleClaimReward]);

  const onboardingComplete = onboarding.every(step => step.done);

  const handlePublish = async (payload: {
    name: string; symbol: string; category: string; basePrice: number;
    volatility: number; creatorShare: number; supplyMode: SupplyMode; supply: number;
  }) => {
    await mutate(() => publishCard(state, payload), () => apiPublishCard(payload));
    addToast(`${payload.symbol} launched on Yellow Ledger! 🚀`, 'publish');
  };

  const handleAdvanceMarket = async () => {
    await mutate(() => advanceMarket(state), () => apiAdvanceMarket());
  };

  const handleReset = () => {
    if (authMode === 'server') { void apiResetGame().then(r => setState(r.state)); return; }
    applyState(createInitialState());
    addToast('Game reset 🍌', 'info');
  };

  const handleAuthSuccess = (user: ApiUser, newState: GameState) => {
    setAuthUser(user);
    setState(newState);
    setAuthMode('server');
    setShowAuthModal(false);
    addToast(`Welcome, ${user.displayName}! 🍌`, 'info');
  };

  const handleLogout = () => {
    clearStoredToken();
    setAuthUser(null);
    setAuthMode('guest');
    setState(createInitialState());
    addToast('Signed out', 'info');
  };

  const pulseUp = marketPulse >= 0;

  return (
    <div className="app-root">
      {/* ── SIDEBAR ─────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">🏦</span>
          <div>
            <p className="sidebar-title">Yellow Ledger</p>
            <p className="sidebar-sub">Yellow Ledger</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {pages.map(p => (
            <button
              key={p.id}
              type="button"
              className={`sidebar-link ${activePage === p.id ? 'sidebar-link-active' : ''}`}
              onClick={() => setActivePage(p.id)}
              id={`nav-${p.id}`}
            >
              <span className="sidebar-link-icon">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        {/* Wallet block */}
        <div className="sidebar-wallet">
          <p className="sidebar-wallet-label">Net worth</p>
          <p className="sidebar-wallet-value">{formatCurrency(netWorth)}</p>
          <div className="sidebar-xp-bar">
            <div className="sidebar-xp-fill" style={{ width: `${Math.min(100, (progression.xp / progression.nextLevelTarget) * 100)}%` }} />
          </div>
          <p className="sidebar-wallet-sub">Lv {progression.level} · {progression.xp}/{progression.nextLevelTarget} XP</p>
        </div>

        {/* Auth block */}
        <div className="sidebar-auth">
          {authUser ? (
            <div className="sidebar-user">
              <div className="sidebar-avatar">{authUser.displayName.charAt(0).toUpperCase()}</div>
              <div className="sidebar-user-info">
                <p className="sidebar-user-name">{authUser.displayName}</p>
                <button type="button" className="sidebar-logout" onClick={handleLogout}>Sign out</button>
              </div>
            </div>
          ) : (
            <button type="button" className="sidebar-signin-btn" onClick={() => setShowAuthModal(true)} id="signin-btn">
              Sign in to save progress
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────────── */}
      <div className="main-col">
        {/* Top bar */}
        <header className="topbar">
          {/* Live ticker */}
          <div className="topbar-ticker">
            <div className="ticker-inner">
              {[...state.market.cards, ...state.market.cards].map((card, i) => {
                const price = getMarketPrice(card, state.market.tick, state.market.day);
                const history = card.priceHistory ?? [];
                const prev = history.length >= 2 ? history[history.length - 2] : price;
                const up = price >= prev;
                return (
                  <span key={`${card.id}-${i}`} className={`ticker-item ${up ? 'ticker-up' : 'ticker-dn'}`}>
                    <span className="ticker-sym">{card.symbol}</span>
                    <span className="ticker-price">{formatCurrency(price)}</span>
                    <span>{up ? '▲' : '▼'}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Right controls */}
          <div className="topbar-right">
            <span className={`topbar-pulse ${pulseUp ? 'pulse-up' : 'pulse-dn'}`}>
              {pulseUp ? '▲' : '▼'} {pulseUp ? '+' : ''}{formatCurrency(marketPulse)}
            </span>
            <span className="topbar-day">Day {state.market.day} · Tick {state.market.tick}</span>
            {progression.dailyReady && (
              <button type="button" className="topbar-reward-btn" onClick={handleClaimReward} id="claim-reward-btn">
                🎁 {progression.streak > 1 ? `×${progression.streak} streak` : 'Daily reward'}
              </button>
            )}
            <button type="button" className="topbar-ghost" onClick={handleAdvanceMarket} title="Advance market" id="advance-market-btn">⏩</button>
            <button type="button" className="topbar-ghost" onClick={handleReset} title="Reset run" id="reset-game-btn">↺</button>
            {!authUser && (
              <button type="button" className="topbar-signin" onClick={() => setShowAuthModal(true)} id="topbar-signin-btn">
                Sign in
              </button>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="page-content">

          {/* ── MARKET ─────────────────────────────────── */}
          {activePage === 'market' && (
            <div className="page-section">
              {showOnboarding && (
                <section className="onboarding-panel">
                  <div className="onboarding-head">
                    <div>
                      <p className="onboarding-kicker">Getting started</p>
                      <h2 className="onboarding-title">Your first trading loop</h2>
                      <p className="onboarding-copy">Use this checklist to turn the game from a static market into a progression loop.</p>
                    </div>
                    <button type="button" className="onboarding-close" onClick={() => setShowOnboarding(false)}>
                      Dismiss
                    </button>
                  </div>

                  <div className="onboarding-grid">
                    {onboarding.map(step => (
                      <div key={step.id} className={`onboarding-step ${step.done ? 'onboarding-step-done' : ''}`}>
                        <div className="onboarding-step-top">
                          <span className="onboarding-step-dot">{step.done ? '✓' : '•'}</span>
                          <strong>{step.label}</strong>
                        </div>
                        <p className="onboarding-step-copy">{step.detail}</p>
                        {step.onAction ? (
                          <button type="button" className="onboarding-step-btn" onClick={step.onAction}>
                            {step.action}
                          </button>
                        ) : (
                          <span className="onboarding-step-state">{step.action}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="onboarding-footer">
                    <span>{onboardingComplete ? 'Starter loop complete. Keep compounding.' : 'Finish the loop to unlock the creator economy.'}</span>
                    <button type="button" className="onboarding-link" onClick={() => setActivePage('news')}>Check the news for market signals</button>
                  </div>
                </section>
              )}

              <div className="page-heading">
                <div>
                  <h1 className="page-title">Trade Floor</h1>
                  <p className="page-desc">Prices update every 5 seconds. Anti-whale slippage applies for large positions.</p>
                </div>
                <div className="page-stats">
                  <div className="stat-pill"><span>Cash</span><strong>{formatCurrency(state.player.cash)}</strong></div>
                  <div className="stat-pill"><span>Cards</span><strong>{state.market.cards.length}</strong></div>
                </div>
              </div>
              <div className="market-grid">
                {state.market.cards.map(card => (
                  <MarketCard key={card.id} card={card} state={state} onBuy={handleBuy} onSell={handleSell} onOrder={handleOrder} />
                ))}
              </div>
            </div>
          )}

          {/* ── PORTFOLIO ──────────────────────────────── */}
          {activePage === 'portfolio' && (
            <div className="page-section">
              <div className="page-heading">
                <div>
                  <h1 className="page-title">Portfolio</h1>
                  <p className="page-desc">Your positions, cost basis, and unrealized P&L.</p>
                </div>
              </div>
              <Portfolio state={state} onSell={handleSell} onRunAdCampaign={handleRunAdCampaign} />
            </div>
          )}

          {/* ── CREATOR ────────────────────────────────── */}
          {activePage === 'creator' && (
            <div className="page-section">
              <div className="page-heading">
                <div>
                  <h1 className="page-title">Creator Studio</h1>
                  <p className="page-desc">Design your own card — supply model, volatility, and creator royalties. Requires $5,000 net worth.</p>
                </div>
              </div>
              <CreatorStudio state={state} onPublish={handlePublish} />
            </div>
          )}

          {/* ── LEADERBOARD ────────────────────────────── */}
          {activePage === 'leaderboard' && (
            <div className="page-section">
              <div className="page-heading">
                <div>
                  <h1 className="page-title">Leaderboard</h1>
                  <p className="page-desc">Rankings update every market tick. Streaks multiply your daily rewards.</p>
                </div>
              </div>
              <Leaderboard
                leaderboard={state.market.leaderboard}
                playerName={authUser?.displayName ?? 'You'}
                playerNetWorth={netWorth}
              />
            </div>
          )}

          {/* ── NEWS ───────────────────────────────────── */}
          {activePage === 'news' && (
            <div className="page-section">
              <div className="page-heading">
                <div>
                  <h1 className="page-title">The Banana Times</h1>
                  <p className="page-desc">Dynamic headlines driven by real price events and market conditions.</p>
                </div>
              </div>
              <Newspaper 
                news={state.market.news} 
                market={state.market} 
                rumors={state.player.rumors ?? []} 
                onBuyRumor={handleBuyRumor} 
                cash={state.player.cash} 
              />
            </div>
          )}

          {/* Activity log — always visible at bottom */}
          <div className="activity-log">
            <p className="activity-log-title">Activity log</p>
            <div className="log-entries">
              {state.log.map((entry, i) => (
                <div key={i} className="log-entry">{entry}</div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* ── AUTH MODAL ──────────────────────────────────────── */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
