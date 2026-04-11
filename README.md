# Peel Exchange (Banana Trading Company)

Banana Trading Company is an institutional-grade trading simulator built with a React + TypeScript frontend and a Prisma-backed Express backend. 

Players trade dynamic assets over a simulated market, manage risk, grow net worth, and unlock card publishing with creator royalties. The entire architecture runs over a real-time low-latency WebSocket connection, bridging the core trading UI directly with a synthetic limit order book.

## Highlights & Advanced Mechanics
- **Robust Relational Data**: Swapped legacy JSON flat files for a transaction-safe **Prisma + SQLite** schema architecture tracking deep trade histories, portfolio positions, and security audits.
- **The Information Economy**: Buy and sell insider rumors or run massive ad campaigns to artificially blast your card's demand bias into the stratosphere.
- **Live WebSocket Streams**: Say goodbye to tedious REST polling. `Socket.io` hooks the backend AMM ticks natively to your frontend React store for synchronous global price action.
- **Headless AI Market Makers**: You are not alone. The background server simultaneously runs "Momentum Algos", "Whales", and "Retail Swarms" that execute pure trades against the Prisma engine, resulting in continuous organic lifecycle behavior and explosive volume spikes.
- **Limit Order Engineering**: Utilize the advanced control panel within Market Cards to define specific Bid/Ask **Limit Orders**. The proprietary matching pipeline will cache your query and instantly fill it off the backend ledger if overlap is detected.
- **Creator Studio**: Publish custom cards after reaching the net worth threshold and reap liquidity provider fees forever.

## Backend Safety Features
The persistence engine natively throttles unfair market movements:
- Strict ORM input constraint validation via `zod`.
- Transactional integrity to prevent race conditions during rapid buy/sells.
- Detailed Audit extraction algorithms for flagging network abuse.
- Circuit Breakers: Auto-halt trading on underlying assets suffering from extreme unpredicted volatility limits.

## Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Socket.io-client
- **Backend**: Node.js, Express, TypeScript, Socket.io, JWT auth
- **Database**: Prisma ORM, SQLite (`dev.db`)

## Project Structure
- `src/`: Client-side React interface and unified `game.ts` formulas.
- `server/`: Application routing, WebSockets, and bots (`bots.ts`, `matching.ts`).
- `prisma/`: Relational schema declarations and configuration mapping.
- `public/`: Static bundled asset references.

## Getting Started

### 1) Install
```bash
npm install
```

### 2) Database Setup
Ensure your Prisma schema is cleanly pushed to SQLite:
```bash
npx prisma db push
npx prisma generate
```

### 3) Run Environment
```bash
npm run dev
```

This starts:
- Frontend (Vite): http://localhost:5173
- Backend (Express): http://localhost:3001
- WebSockets: Binds successfully to PORT 3001

## Available Scripts

- `npm run dev`: Boot frontend and backend concurrently in watch mode.
- `npm run build`: Type-checks and creates a unified frontend production bundle under `/dist`.
- `npm run build:server`: Isolated backend compilation.
- `npm run lint`: Run global ESLint configs.
- `npm run preview`: Serve the compiled `index.html` static site builder.

## API Overview

Main API routes are under `/api`:

- **Auth**: `/api/auth/signup`, `/api/auth/login`, `/api/auth/me`
- **Exchange**: `/api/game/state`, `/api/game/buy`, `/api/game/sell`, `/api/game/order`
- **Information**: `/api/game/rumor`, `/api/game/advertise`, `/api/game/publish`
- **Progress**: `/api/game/reward/daily`, `/api/game/leaderboard`, `/api/game/summary`
- **Utility**: `/api/game/news`, `/api/game/trades`, `/api/game/portfolio`, `/api/game/orders`

*(Note: In production mode, the Express server gracefully serves React routes via `app.use(express.static('dist'))` fallback).*
