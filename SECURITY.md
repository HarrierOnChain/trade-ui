# Security

Trade UI holds private keys, so its security model is spelled out here. If
something below does not hold, that is a vulnerability: please report it.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the repository's **Security** tab
→ **Report a vulnerability**. Do not open a public issue for it. Include what
an attacker needs (network position, access to the machine, a page open in the
same browser…) and what they get.

## What protects the keys

- **The vault.** Every wallet lives in `vault.json` in the data folder
  (`TRADE_UI_DATA_DIR`, or the app's folder on desktop), file mode 0600. It is
  one AES-256-GCM ciphertext under a random 256-bit data key. The data key is
  stored twice, wrapped with AES-256-GCM: under a key derived from your
  password with scrypt (N=2^17, r=8, p=1, 16-byte salt), and under a key
  derived from the recovery key with HKDF-SHA256 (its own salt). Each wrap
  binds its derivation parameters as associated data; every write uses fresh
  IVs and replaces the file atomically. Addresses and labels are inside the
  ciphertext too: a locked vault shows nothing.
- **The recovery key.** 160 random bits, shown once when the vault is made
  (nine groups of four characters, the last a checksum that catches typos),
  never stored by Trade UI. On the lock screen it replaces a forgotten
  password; it is throttled like a password, though 160 bits cannot be
  guessed. Anyone who has it and can reach your Trade UI can set a new
  password and use the wallets, so keep it offline. Making a new one (which
  asks the password) retires the old one and changes the data key, so an old
  copy of the file opened with an old password or recovery key says nothing
  about what the vault holds afterwards. Changing the password keeps the data
  key and the recovery key.
- **The lock.** The key exists only in the server's memory while the vault is
  unlocked. Locking (the lock button, the idle delay, a restart) zeroes it and
  ends every session. Each browser that typed the password holds a session: a
  random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie, of which the
  server keeps only the SHA-256.
- **Wrong passwords.** Counted per client: per address for unlock and setup,
  per session for the checks an unlocked browser makes (export, delete, send,
  password change). After four in a row that client waits: 2 s, doubling, up
  to 5 minutes. Someone guessing from elsewhere cannot lock you out, or out of
  an open session. Across all clients, after 20 failures in a row attempts are
  paced to one a second, which bounds a guesser that rotates addresses; one
  right password ends it. The counts live in memory: a restart clears them,
  and also locks the vault. There is no wipe after N attempts: on a server
  reachable from the internet, anyone could trigger it. Behind a reverse proxy
  on the same machine, the client's address is the proxy's last
  `X-Forwarded-For` entry; from anywhere else that header is ignored.
- **Passwords asked again** for what cannot be undone: exporting a key,
  deleting a wallet that has one, sending SOL. Trades do not ask: they are the
  point of a trading terminal.
- **What the server signs.** Only (1) a swap transaction it has just received
  from the configured router (`RAZE_ROUTER_BASE`) for that wallet, after
  checking that the wallet is its one and only signer, (2) on the EVM chains,
  the approvals and swap the EVM router (`RAZE_ROUTER_EVM_BASE`) has just
  built for that wallet, after its simulation passed and after checking each
  one: this wallet and chain, the quote's amount and minimum, approvals only
  of the input token, only to the venue's router named in the quote and for
  at most the amount, the swap to that router with the quote's value, and a
  bounded gas limit; and (3) a SOL
  transfer it builds itself. There is no endpoint that signs bytes sent by the
  browser.
- **What a swap may be.** The quote is the router's: the server asks for it,
  keeps it for a minute and gives the browser a random token for it. A trade
  names the token, and the router builds that quote as it gave it: a browser
  (or anything holding a session) cannot change the route, the amounts or the
  minimum received. The slippage a quote may ask for is capped by
  `SWAP_MAX_SLIPPAGE_BPS` (default 50 %). The router is trusted to build the
  swap it quoted, as with any aggregator.
- **A session's work ends with it.** Locking closes every stream and
  WebSocket a session opened, including handshakes still waiting for the
  upstream, and drops the kept quotes. A swap or transfer whose session ended
  while the router or the RPC was answering is not signed.
- **The browser never holds a key** unless you export one. The Raze API key
  never reaches it either: the server adds it to the requests it proxies, and
  nothing the browser sends can point those proxies elsewhere.

## What protects the server

- Everything under `/api/` needs a session, except the lock's own routes:
  the market-data proxy, the router, the Solana RPC proxy, the wallet routes
  and both WebSocket proxies. Pages and static files are public; they are this
  open-source app.
- Requests that change something need the `x-trade-ui: 1` header and, when the
  browser sends one, an Origin of the same host: another site cannot make your
  browser act. WebSockets check the Origin too.
- Host names are checked against DNS rebinding, wherever the server listens:
  `localhost` and IP addresses are answered, and a domain name only when it is
  `TRADE_UI_PUBLIC_URL`'s or listed in `TRADE_UI_ALLOWED_HOSTS`.
- What Next.js serves under `/api/` only runs behind that gate: the gate adds
  a per-process secret header that the route handlers require, and drops any
  copy a client sends.
- The proxies follow no redirects (the API key would go with them), cap the
  size of what they forward, and serve the API's answers only as JSON, text
  or event streams, with `nosniff` and a sandboxing CSP: an answer cannot
  become a page of this site.
- The first password can only be set with the setup code printed in the
  server's log (the desktop app passes it itself), so a fresh install on a
  public address cannot be claimed by someone else.

## What you are responsible for

- **HTTPS** whenever Trade UI is reached from another machine. Over plain HTTP
  the password and the session cookie cross the network readable; the lock
  screen warns about it.
- **The machine.** Whoever controls the server (or your computer, for the
  desktop app) while the vault is unlocked can use the keys. Memory of a
  running Node process is not protected against its own operator. The Docker
  and systemd setups turn core dumps off, so a crash does not write the key
  to disk; elsewhere that is the system's setting.
- **Backups.** Keep the recovery key offline, apart from the vault file, and
  back up the file. Without the password or the recovery key the file is
  useless; exported keys are the last resort.
- **The RPC and the router you configure** see your transactions, like any
  RPC and aggregator.
