# charts-qa — Playwright harness per @razedotbot/charts dentro l'app

Script QA che pilotano l'app Next **live** (default `http://localhost:3210`)
per verificare il chart engine `@razedotbot/charts` su pagine reali
(/monitor, /token/<mint>). Spostati qui da
`raze-charts/examples/` quando il pacchetto è stato aperto (il repo pubblico
tiene solo esempi self-contained sul mock datafeed).

Richiede `playwright` installato (`npx playwright install chromium`).

| Script | Cosa fa |
|--------|---------|
| `app-qa.mjs [base] [outPrefix]` | /monitor → primo token → chart canvas → screenshot + console errors |
| `find-mint.mjs [base] [out]` | estrae un mint reale dai fiber React di /monitor e apre la token page |
| `click-token.mjs [base] [out]` | click reale a coordinate sulla lista live di /monitor |
| `clip.mjs <mint> <out>` | screenshot della token page con crosshair |
| `dbg-state.mjs <mint>` | dump `__razeChartState` (con `__RAZE_DEBUG=true`) |
| `ip-shot.mjs <url> <out>` | probe secure-context + presenza canvas su URL arbitrario |
