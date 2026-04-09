# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  # Banana Trading Company

  Banana Trading Company is a React + TypeScript trading game built with Vite. You start with cash, trade cards whose prices move with demand and market pressure, and eventually publish your own cards into the exchange.

  ## Features

  - Buy and sell market cards with fees, slippage, supply constraints, and price bounds
  - Publish player-created cards once you reach the required net worth
  - Daily reward loop for steady progression
  - Local save persistence in browser storage
  - Leaderboard and newspaper-style market feed

  ## Development

  ```bash
  npm install
  npm run dev
  ```

  ## Build

  ```bash
  npm run build
  ```
```
