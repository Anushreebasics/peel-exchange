# Banana Trading Company

Banana Trading Company is a React + TypeScript trading game with a Vite frontend and an Express backend.

Players trade cards in a simulated market, manage risk, grow net worth, and unlock card publishing with creator royalties.

## Highlights

- Real-time market simulation with demand, momentum, and seasonality
- Buy/sell trading with fees, slippage, supply constraints, and price bounds
- Creator mode: publish custom cards after reaching the net worth threshold
- Daily rewards and progression loop
- Leaderboard, trade history, and market news feed
- Local game persistence for guest mode
- Authenticated server mode with stored user profiles

## Backend Safety Features

The backend includes protections to keep the market fair and stable:

- Input validation for buy, sell, publish, and reward claims
- Audit trail for accepted and rejected actions
- Anomaly detection for suspicious activity:
  - Wash-trading style rapid alternating trades
  - Unusual trade-size deviations from user behavior
  - Large price spike detection
- Circuit breakers:
  - Auto-halt trading on cards with extreme price moves
  - Timed recovery to prevent cascade volatility

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Backend: Express, TypeScript, JWT auth
- Data: JSON file store (development-friendly persistence)

## Project Structure

- src/: frontend app, game logic, UI components
- server/: API server and persistence layer
- server/data/store.json: local backend data store
- public/: static assets

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Run in development

```bash
npm run dev
```

This starts:

- Frontend (Vite): http://localhost:5173
- Backend (Express): http://localhost:3001

## Build

```bash
npm run build
```

## Available Scripts

- npm run dev: run frontend and backend in watch mode
- npm run build: TypeScript build + frontend production bundle
- npm run lint: run ESLint
- npm run preview: preview production frontend build

## API Overview

Main API routes are under /api:

- Auth: /api/auth/signup, /api/auth/login, /api/auth/me
- Game: /api/game/state, /api/game/buy, /api/game/sell, /api/game/publish
- Progress: /api/game/reward/daily, /api/game/leaderboard, /api/game/summary
- Utility: /api/game/news, /api/game/trades, /api/game/portfolio, /api/game/reset

Debug routes (authenticated):

- /api/debug/audit
- /api/debug/anomalies
- /api/debug/circuit-breakers

## Notes

- Static frontend files are only served by the backend in production mode.
- In development, use the Vite URL for UI and the Express URL for API.
