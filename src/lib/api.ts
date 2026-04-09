import type { GameState } from '../game';

export type ApiUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastLoginAt: string | null;
};

export type AuthResponse = {
  token: string;
  user: ApiUser;
  state: GameState;
};

const TOKEN_KEY = 'banana-trading-company-token';

export function getStoredToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set('Content-Type', 'application/json');

  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed');
  }

  return payload as T;
}

export async function signUp(payload: { email: string; password: string; displayName: string }) {
  const response = await request<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setStoredToken(response.token);
  return response;
}

export async function logIn(payload: { email: string; password: string }) {
  const response = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setStoredToken(response.token);
  return response;
}

export async function getCurrentSession() {
  return request<{ user: ApiUser; state: GameState }>('/api/auth/me');
}

export async function getGameState() {
  return request<{ state: GameState; user: ApiUser }>('/api/game/state');
}

export async function buyCard(cardId: string, quantity = 1) {
  return request<{ state: GameState; trade: unknown }>('/api/game/buy', {
    method: 'POST',
    body: JSON.stringify({ cardId, quantity }),
  });
}

export async function sellCard(cardId: string, quantity = 1) {
  return request<{ state: GameState; trade: unknown }>('/api/game/sell', {
    method: 'POST',
    body: JSON.stringify({ cardId, quantity }),
  });
}

export async function publishCard(payload: {
  name: string;
  symbol: string;
  category: string;
  basePrice: number;
  volatility: number;
  creatorShare: number;
  supplyMode: 'limited' | 'unlimited';
  supply: number;
}) {
  return request<{ state: GameState }>('/api/game/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function claimDailyReward() {
  return request<{ state: GameState }>('/api/game/reward/daily', {
    method: 'POST',
  });
}

export async function advanceMarket() {
  return request<{ state: GameState }>('/api/game/advance', {
    method: 'POST',
  });
}

export async function resetGame() {
  return request<{ state: GameState }>('/api/game/reset', {
    method: 'POST',
  });
}

export async function getLeaderboard() {
  return request<{ leaderboard: Array<{ name: string; netWorth: number; streak: number }> }>('/api/game/leaderboard');
}

export async function getNews() {
  return request<{ news: Array<{ id: string; title: string; body: string; mood: 'positive' | 'neutral' | 'negative'; impact: string }>; events: Array<{ id: string; title: string; body: string; mood: 'positive' | 'neutral' | 'negative'; impact: string }> }>('/api/game/news');
}

export async function getTrades() {
  return request<{ trades: unknown[] }>('/api/game/trades');
}
