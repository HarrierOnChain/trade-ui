# Trade UI

Self-hosted desktop/browser terminal for [api.raze.bot](https://api.raze.bot). Same Monitor, Token, and Portfolio chrome as app.raze.bot, wired to the public multi-chain market-data API. No hosted app backend is required — you run this locally and bring your own API key.

## What it talks to

- **REST:** the market-data API's `/v1` routes (contract: `GET /v1/openapi.yaml` on the API). The Next.js process proxies `/api/raze/*` → `${RAZE_API_BASE}/v1/*`, so the browser never hits CORS and never sees the key.
- **Live:** one WebSocket, `/v1/ws`, carrying every channel the UI uses: `launchpad` (the New / Migrating / Migrated columns), `trades`, `candles` and `token` (the token page), `prices` (SOL/ETH/BNB), `wallet` (the tracker, Solana). Nothing live is polled; REST only primes a view. If no socket can be opened, the columns and the open token fall back to Server-Sent Events (`/v1/stream/{channel}`) through the proxy.
- **Auth:** your key, as `x-api-key`, added server-side. An API running without keys needs none.
- **Wallets:** stored on this machine (watch addresses or locally generated keys). The market-data API does not execute swaps.

## Setup

```bash
git clone <this-repo> trade-ui
cd trade-ui
npm install
cp .env.example .env.local
```

Put a key from [raze.bot/pricing](https://raze.bot/pricing) in `.env.local`:

```
RAZE_API_KEY=your_key
RAZE_API_BASE=https://api.raze.bot
```

| Variable | |
| --- | --- |
| `RAZE_API_BASE` | The API's host root, **without** `/v1`: `https://api.raze.bot`, or a local API such as `http://localhost:8810`. |
| `RAZE_API_KEY` | Sent as `x-api-key` by the proxies. Empty for an API without keys. |

Or leave `.env.local` empty and paste the key on first launch (it is kept in an httpOnly cookie for the proxy).

## Run

Browser:

```bash
npm run dev          # http://127.0.0.1:3000, hot reload: server.cjs --dev
npm run build && npm start   # production: server.cjs
```

Both run `server.cjs`, also what the desktop app starts: the browser opens same-origin `/api/ws`, which `server.cjs` forwards to `${RAZE_API_BASE}/v1/ws` (ws or wss by the base's scheme) with the key from `.env.local`. With plain `next dev` (no upgrade handler) the browser opens the API's `/v1/ws` directly instead — keyless, or with the key typed in Settings (`?apiKey=`) — and otherwise streams over SSE through the proxy.

Desktop (Electron, starts the same Next server in production):

```bash
npm run electron:dev     # Next + Electron together
npm run build && npm start & npm run electron
```

## Pages

| Route | Data |
| --- | --- |
| `/monitor` | New / launchpad / trending columns, live deploys + migrations |
| `/token/{chain}/{address}` | Header, TradingView chart, trades, holders, traders |
| `/portfolio` | Local wallets + holdings / PnL / activity from `/wallets/{chain}/{address}` |

Chain switcher: `sol`, `eth`, `bsc`, `base`, `robinhood`.

## Notes

- The UI keeps prices in the chain's native coin (SOL/ETH/BNB): every `…Usd` field from the API is divided by the live native price at the API layer (`src/api/mappers.ts`), so components did not change units.
- Token images: the row's own URL first, then `/v1/tokens/{chain}/{address}/image` (a 302) through the proxy.
- Candle and trade times are Unix milliseconds. Charts page back with `to`.
- Not served by the API, so hidden or shown as `–`: dev buy, launch market cap, fees, creator graduations, 4h/12h changes, DexScreener-paid, holders' first-trade time.
- Swap execution is not part of the public API. The trading panel keeps the original layout; orders are not submitted to a hosted backend.
- After first run, change the key under Settings → Network.
- Extra original routes (`/trending`, `/deploy`, …) may still exist in the tree; they are not in the nav and are not wired to evmapi.
