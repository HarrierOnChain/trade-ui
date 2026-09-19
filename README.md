# Trade UI

Self-hosted desktop/browser terminal for [api.raze.bot](https://api.raze.bot). Same Monitor, Token, and Portfolio chrome as app.raze.bot, wired to the public multi-chain market-data API. No hosted app backend is required — you run this locally and bring your own API key.

## What it talks to

- **REST + live streams:** `https://api.raze.bot` (or a local `evmapi` at `http://127.0.0.1:8810`)
- **Auth:** your key, as `x-api-key`. The Next.js process proxies `/api/raze/*` so the browser does not hit CORS.
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

Or leave `.env.local` empty and paste the key on first launch.

## Run

Browser:

```bash
npm run dev          # http://127.0.0.1:3000
```

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

- Image URLs in API JSON are relative (`/tokens/.../image`); the UI prefixes them with the local proxy.
- OHLC `from`/`to` are milliseconds. Wallet PnL `from`/`to` are seconds.
- Swap execution is not part of the public API. The trading panel keeps the original layout; orders are not submitted to a hosted backend.
- After first run, change the key under Settings → Network.
- Extra original routes (`/trending`, `/deploy`, …) may still exist in the tree; they are not in the nav and are not wired to evmapi.
