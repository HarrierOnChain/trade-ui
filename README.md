# Trade UI

Self-hosted desktop/browser terminal for [api.raze.bot](https://api.raze.bot). Same Monitor, Token, and Portfolio chrome as app.raze.bot, wired to the public multi-chain market-data API, with Solana swaps on the Raze router. No hosted app backend is required — you run this locally and bring your own API key.

## What it talks to

- **REST:** the market-data API's routes (contract: `GET /openapi.yaml` on the API). The Next.js process proxies `/api/raze/*` → `${RAZE_API_BASE}/*`, so the browser never hits CORS and never sees the key.
- **Live:** one WebSocket, `/ws`, carrying every channel the UI uses: `launchpad` (the New / Migrating / Migrated columns), `trades`, `candles` and `token` (the token page), `prices` (SOL/ETH/BNB), `wallet` (the tracker, Solana). Nothing live is polled; REST only primes a view. If no socket can be opened, the columns and the open token fall back to Server-Sent Events (`/stream/{channel}`) through the proxy.
- **Auth:** your key, as `x-api-key`, added server-side. An API running without keys needs none.
- **Swaps (Solana):** the Raze router (`RAZE_ROUTER_BASE`, keyless) quotes and builds; the wallet signs; an RPC (`SOLANA_RPC_URL`) sends and confirms. See [Swaps](#swaps).
- **Wallets:** local wallets stored on this machine (watch addresses or locally generated / imported keys), and a browser wallet (Phantom, Solflare, Backpack, … through the Wallet Standard).

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
| `RAZE_API_BASE` | The API's host root: `https://api.raze.bot`, or a local API such as `http://localhost:8810`. |
| `RAZE_API_KEY` | Sent as `x-api-key` by the proxies. Empty for an API without keys. |
| `RAZE_ROUTER_BASE` | The Solana router: quotes, venues, swap builds. Default `https://router.raze.bot`. |
| `SOLANA_RPC_URL` | Sends and confirms swaps, reads balances. Must accept v1 transactions (SIMD-0385). Default `https://api.mainnet-beta.solana.com` (rate-limited: use your own for real volume). |
| `SOLANA_WS_URL` | The RPC's WebSocket, for confirmations. Default: `SOLANA_RPC_URL` with `ws(s)://`. |
| `SWAP_PRIORITY_MAX_LAMPORTS` | Cap of the router's own priority-fee estimate when no fee is set (the `/swap` page). Default `500000`. |
| `SWAP_ALLOW_SPLIT` | `1` lets a quote split across two routes. Off by default. |

Or leave `.env.local` empty and paste the key on first launch (it is kept in an httpOnly cookie for the proxy).

## Run

Browser:

```bash
npm run dev          # http://127.0.0.1:3000, hot reload: server.cjs --dev
npm run build && npm start   # production: server.cjs
```

Both run `server.cjs`, also what the desktop app starts: the browser opens same-origin `/api/ws`, which `server.cjs` forwards to `${RAZE_API_BASE}/ws` (ws or wss by the base's scheme) with the key from `.env.local`. With plain `next dev` (no upgrade handler) the browser opens the API's `/ws` directly instead — keyless, or with the key typed in Settings (`?apiKey=`) — and otherwise streams over SSE through the proxy.

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
| `/swap` | Any pair of Solana tokens on the router: live quote, route and split, DEX filter, slippage |

Chain switcher: `sol`, `eth`, `bsc`, `base`, `robinhood`.

## Notes

- The UI keeps prices in the chain's native coin (SOL/ETH/BNB): every `…Usd` field from the API is divided by the live native price at the API layer (`src/api/mappers.ts`), so components did not change units.
- Token images: the row's own URL first, then `/tokens/{chain}/{address}/image` (a 302) through the proxy.
- Candle and trade times are Unix milliseconds. Charts page back with `to`.
- Not served by the API, so hidden or shown as `–`: dev buy, launch market cap, fees, creator graduations, 4h/12h changes, DexScreener-paid, holders' first-trade time.
- After first run, change the key under Settings → Network.
- Extra original routes (`/trending`, `/deploy`, …) may still exist in the tree; they are not in the nav and are not wired to evmapi.

## Swaps

Solana only for now: the EVM router (`api/crates/router/evm`) does not quote yet, so on ETH / BSC / Base / Robinhood the trading panel says so and does not trade.

Where you trade:

- the token page's panel (market buy and sell, the presets, the floating Instant Trade panel), one trade per selected wallet, all at once;
- the ⚡ quick buy on monitor rows and the sidebar's quick buy / sell;
- `/swap`, any pair.

Every trade is the same path (`src/lib/swap/`):

1. **Quote:** `GET /api/swap/quote` → router `GET /quote`. The panel shows it under the amount (output, impact, venues). `/swap` refreshes it every 800 ms while the page is visible: the router has no push stream.
2. **Build:** `POST /api/swap/build` → router `POST /swap-instructions` with that quote, so the floor shown is the floor the program enforces. The router builds **v1** transactions only.
3. **Sign:**
   - a local wallet signs here, with its key (ed25519 over the v1 message);
   - a browser wallet gets the raw bytes through `solana:signAndSendTransaction`. A wallet that does not declare v1 gets the same instructions re-assembled as **v0** by the server (`src/lib/swap/v0.ts`), quoted with `reserveKeys=39` so the route fits 1,232 bytes.
4. **Send:** `POST /api/solana/rpc` (only `sendTransaction`, `getSignatureStatuses`, `getBalance`, `getTokenAccountsByOwner`, `getAccountInfo`), with preflight. A swap that would fail is refused before it costs a fee.
5. **Confirm:** `signatureSubscribe` on `/api/solana/ws`, which `server.cjs` forwards to the RPC's WebSocket. Under plain `next dev` (no socket) it falls back to reading the status every 1.5 s.

Notes:

- The priority fee is the panel's ⛽ value (total lamports). Slippage is the panel's 🔥 value; `/swap` has its own.
- A sell by % reads the exact token balance from the RPC: 100% sells every last unit.
- Market orders only. Limit orders, the Adv. automations, MEV relays and the platform fee need a server that is not part of Trade UI.
- Demo wallets do not trade on chain. Watch-only wallets cannot sign.
- Local keys live in this browser's `localStorage`, unencrypted, like the rest of the local wallet store. Keep only trading balances in them.

## Tests

```bash
npm test     # node --test: trade lists, and the swap path (quote, forwarding, v0, local signing, trade → swap)
```
