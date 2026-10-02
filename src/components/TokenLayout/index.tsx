"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { TVChart, type TradeMark, type MarkKind, type OrderLine } from "../TVChart";
import { prefetchSolanaChartData } from "../SolanaDatafeed";
import { TokenHeader } from "../TokenHeader";
import { Icon, Tooltip } from "../atoms";
import { fetchTokenSupply, fetchTradesBySignerMint } from "../../api/client";
import { useBackend } from "../../api/backend";
import { onDemoChanged } from "../../lib/demoEvents";
import type { Trade } from "../../types";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useTrades } from "../../hooks/useTrades";
import { useHolders } from "../../hooks/useHolders";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useLastSeen } from "../../contexts/LastSeenContext";
import { useApp } from "../../contexts/AppContext";
import { WATCHLIST_STORAGE_KEY, readWatchlist } from "../../lib/trackerWallets";
import { useLimitOrders } from "../../hooks/useLimitOrders";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { Pill } from "../atoms";
import { fmtNum } from "../../lib/format";
import { solPriceToChartAxis } from "../../lib/chartAxis";
import { computeTop10HolderAvgPrices } from "../../lib/topHolderLines";
import { tradeKey } from "../../lib/trades";
import { top10HoldPct } from "../../lib/tokenMetrics";
import { useUserPreference } from "../../hooks/useUserPreference";
import { PREF_KEYS } from "../TradingPanel/presets";
import { TradeCategoryFilter } from "../TradeCategoryFilter";
import { TokenTradesSidebar } from "../TokenTradesSidebar";
import { Modal, Btn, ModalHeader, ModalFooter } from "../atoms";
import { viewportMaxWidth } from "../../lib/popover";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { getActiveChain, nativeSymbol } from "../../lib/chains";

// TVChart is imported eagerly so OHLC prefetch + chart init start with
// token-info/trades (wire RPCs are concurrent on the backend). Other heavy
// panels stay lazy so the shell still paints quickly.
const TradesTable = lazy(() => import("../TradesTable").then(m => ({ default: m.TradesTable })));
const HoldersTable = lazy(() => import("../HoldersTable").then(m => ({ default: m.HoldersTable })));
const TopTradersTable = lazy(() => import("../TopTradersTable").then(m => ({ default: m.TopTradersTable })));
const BubblemapPanel = lazy(() => import("../BubblemapPanel").then(m => ({ default: m.BubblemapPanel })));
const TradingPanel = lazy(() => import("../TradingPanel").then(m => ({ default: m.TradingPanel })));
const PriceChangeStrip = lazy(() => import("../PriceChangeStrip").then(m => ({ default: m.PriceChangeStrip })));

type Tab = "trades" | "holders" | "traders" | "bubblemap" | "orders";
type TradeCat = "dev" | "tracked" | "you";
type MobileSection = "chart" | "transactions" | "trading";

const CAT_LABEL: Record<TradeCat, string> = {
  dev: "DEV",
  tracked: "TRACKED",
  you: "YOU",
};

interface TokenLayoutProps {
  mint: string;
  /** When set, replaces the default trading-panel slot. The deploy page
   *  uses this to inject the create-token form into the same token-page
   *  chrome — TokenHeader / TVChart / TradesTable / HoldersTable et al.
   *  are reused verbatim. */
  sidePanel?: React.ReactNode;
  /** Default `"right"` (where the trading panel naturally lives). Pass
   *  `"left"` to mirror the layout so the side panel sits before the chart
   *  column — used by the `/deploy` page. */
  sidePanelSide?: "left" | "right";
  /** Override the side-panel column width (px). Defaults to 304 — the
   *  trading-panel width — so swapping in something narrower/wider doesn't
   *  silently push the chart around. */
  sidePanelWidth?: number;
  /** Whether to record this mint as "recently seen". Default true. The /deploy
   *  page passes `false` pre-launch so the throwaway placeholder mint never
   *  leaks into the Recent-pairs ticker. */
  recordSeen?: boolean;
  /** Pre-launch only: replaces the first ("Transactions") tab body with a
   *  custom node — the /deploy page injects its editable buyers table here so
   *  wallets/amounts can be edited inline under the chart. When set, the tab
   *  is relabeled and the trades-only header filters are hidden. */
  bottomPanel?: { label: string; node: React.ReactNode };
  /** Hide the header "Clone token" DNA action — the /deploy preview sets this
   *  (the placeholder token being created can't be cloned). */
  hideHeaderClone?: boolean;
}

export function TokenLayout({
  mint,
  sidePanel,
  sidePanelSide = "right",
  sidePanelWidth,
  recordSeen = true,
  bottomPanel,
  hideHeaderClone = false,
}: TokenLayoutProps) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const { record, forget } = useLastSeen();
  useEffect(() => {
    if (recordSeen) record(mint);
    // Deploy preview: never leave the throwaway placeholder in Recent — drop it
    // (also cleans stale entries from before this guard existed).
    else forget(mint);
  }, [mint, record, forget, recordSeen]);
  useEffect(() => { prefetchSolanaChartData(mint); }, [mint]);
  const { pushToast } = useApp();
  const limitOrders = useLimitOrders(mint);
  const livePriceMap = useLiveTradePrices(useMemo(() => [mint], [mint]));

  const [tab, setTab] = useState<Tab>("trades");
  const [mobileSection, setMobileSection] = useState<MobileSection>("chart");
  const [supply, setSupply] = useState(0);
  const [chartCurrency, setChartCurrency] = useState<"usd" | "sol">("usd");
  const [tradesCurrency, setTradesCurrency] = useState<"usd" | "sol">("usd");
  const [chartDisplay, setChartDisplay] = useState<"mcap" | "price">("mcap");
  const [tradesDisplay, setTradesDisplay] = useState<"mcap" | "price">("mcap");
  const [filterSigner, setFilterSigner] = useState<string | null>(null);
  const [walletQuery, setWalletQuery] = useState("");
  const CHART_HEIGHT_KEY = "token:chartHeight";
  const CHART_MIN = 220;
  const CHART_MAX_VH_FRAC = 0.8;
  const TRADING_PANEL_WIDTH = 304; // 320 − 5%
  // Width of the side-panel column. Desktop is byte-identical to the old fixed
  // px (`sidePanelWidth ?? TRADING_PANEL_WIDTH` = 304); on mobile the panel
  // stacks below the chart and spans the full row. The celebration overlay
  // still reserves the literal px number (`TRADING_PANEL_WIDTH`).
  const sidePanelColWidth: React.CSSProperties["width"] = isMobile
    ? "100%"
    : (sidePanelWidth ?? TRADING_PANEL_WIDTH);
  // Chart sizing: fixed, non-resizable on mobile (drag handle hidden); the
  // persisted/resizable height stays exactly as before on desktop.
  const MOBILE_CHART_HEIGHT = 320;
  // SSR-stable default. The persisted value loads in the useEffect below.
  // Initializing from localStorage here would diverge between SSR and the
  // first client render and trigger React #418 (hydration text mismatch).
  const [chartHeight, setChartHeight] = useState<number>(420);
  const effectiveChartHeight = isMobile ? MOBILE_CHART_HEIGHT : chartHeight;
  const [chartHeightHydrated, setChartHeightHydrated] = useState(false);
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Post-mount: load the saved chart height from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = Number(window.localStorage.getItem(CHART_HEIGHT_KEY));
    if (Number.isFinite(saved) && saved >= CHART_MIN) setChartHeight(saved);
    setChartHeightHydrated(true);
  }, [CHART_HEIGHT_KEY, CHART_MIN]);

  // Persist on change — only after the initial load, so we don't overwrite
  // the saved value with the default 420 on first paint.
  useEffect(() => {
    if (typeof window === "undefined" || !chartHeightHydrated) return;
    window.localStorage.setItem(CHART_HEIGHT_KEY, String(chartHeight));
  }, [chartHeight, chartHeightHydrated, CHART_HEIGHT_KEY]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startY: e.clientY, startHeight: chartHeight };
    setIsResizing(true);
    // Chart canvas captures pointer events; without this the drag stalls
    // as soon as the cursor crosses into the chart. Disabling pointer
    // events on <body> cascades to every descendant (pointer-events is an
    // inherited property), so the chart stops receiving events. Once
    // mousedown has fired, document-level capture-phase listeners pick up
    // mousemove/mouseup regardless of where the cursor is — no element
    // needs to remain interactive for the drag to track.
    document.body.style.pointerEvents = "none";
    const onMove = (ev: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const delta = ev.clientY - state.startY;
      const containerH = leftColRef.current?.clientHeight ?? window.innerHeight;
      const maxByContainer = Math.max(CHART_MIN, containerH - 180);
      const maxByViewport = Math.max(CHART_MIN, window.innerHeight * CHART_MAX_VH_FRAC);
      const max = Math.min(maxByContainer, maxByViewport);
      const next = Math.min(max, Math.max(CHART_MIN, state.startHeight + delta));
      setChartHeight(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      setIsResizing(false);
      document.body.style.pointerEvents = "";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  }, [chartHeight]);
  const solPrice = useSolPrice();
  const onChartCurrencyChange = useCallback((c: "usd" | "sol") => setChartCurrency(c), []);
  const onTradesCurrencyChange = useCallback((c: "usd" | "sol") => setTradesCurrency(c), []);
  const onChartDisplayChange = useCallback((d: "mcap" | "price") => setChartDisplay(d), []);
  const onTradesDisplayChange = useCallback((d: "mcap" | "price") => setTradesDisplay(d), []);

  useEffect(() => {
    fetchTokenSupply(mint)
      .then((res) => {
        const s = res.supply ?? 0;
        setSupply(s >= 1_000_000 ? s : 1_000_000_000);
      })
      .catch(() => {});
  }, [mint]);

  // Page-level fetches feed chart marks (trades) and the bubblemap / top-10 %
  // (holders). The corresponding tables run their own copies of these hooks;
  // REST duplication is collapsed by the cachedRazeGet wrapper in
  // src/api/client.ts, and WS subscriptions are ref-counted in websocket.ts,
  // so the on-the-wire cost is a single fetch + a single subscribe per mint.
  const { trades, loading: tradesLoading } = useTrades(mint);
  const { holders } = useHolders(mint);

  // ── Chart marks: dev / tracked / own-wallet trades ──────────────────────
  const { info } = useTokenInfo(mint);
  const activeOrderLines = useMemo<OrderLine[]>(
    () =>
      limitOrders.orders
        .filter((o) => o.status === "active")
        .map((o) => ({
          id: o.id,
          side: o.side as "buy" | "sell",
          targetMcapUsd: o.limitConfig.targetMcapUsd,
          quantity: o.side === "buy" ? `${o.amount} SOL` : `${o.amount}%`,
        })),
    [limitOrders.orders],
  );

  const handleOrderLineDrag = useCallback((id: string, newTargetMcapUsd: number) => {
    // Optimistic update so the line stays put visually.
    limitOrders.update(id, newTargetMcapUsd).catch((err) => {
      pushToast({
        title: "ORDER UPDATE FAILED",
        body: err instanceof Error ? err.message : String(err),
        tone: "sell",
      });
    });
  }, [limitOrders, pushToast]);

  const handleOrderLineCancel = useCallback((id: string) => {
    limitOrders.cancel(id).catch((err) => {
      pushToast({
        title: "CANCEL FAILED",
        body: err instanceof Error ? err.message : String(err),
        tone: "sell",
      });
    });
  }, [limitOrders, pushToast]);

  const liveMarketCap = useMemo(() => {
    const liveSol = livePriceMap.get(mint)?.price ?? 0;
    const sp = solPrice ?? 0;
    const live = liveSol > 0 && sp > 0 ? liveSol * sp * supply : 0;
    return live > 0 ? live : (info?.marketCap ?? null);
  }, [livePriceMap, mint, solPrice, supply, info?.marketCap]);
  const devSigner = info?.signer ?? null;
  const userWallets = useUserWallets();
  const userAddrs = useMemo(
    () => new Set(userWallets.wallets.map((w) => w.pubkey)),
    [userWallets.wallets],
  );
  const [watchAddrs, setWatchAddrs] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const sync = () => setWatchAddrs(new Set(readWatchlist().map((w) => w.address)));
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Dev trades usually sit at deploy time and fall outside the default
  // 50-trade live feed. Fetch them by signer directly so the "Dev" marks
  // show up regardless of token age or activity.
  const [devTrades, setDevTrades] = useState<Trade[]>([]);
  useEffect(() => {
    if (!devSigner || !mint) {
      setDevTrades([]);
      return;
    }
    let cancelled = false;
    fetchTradesBySignerMint(devSigner, mint, 100)
      .then((res) => {
        if (cancelled) return;
        setDevTrades(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setDevTrades([]);
      });
    return () => { cancelled = true; };
  }, [devSigner, mint]);

  // Trades for every user-owned wallet on this token. The live feed only
  // returns the latest 50 trades, so user trades older than that window
  // would never produce "my wallets" marks/lines without an explicit fetch
  // per wallet — same pattern as devTrades/filteredTrades.
  const userPubkeysKey = useMemo(
    () => [...userAddrs].sort().join(","),
    [userAddrs],
  );
  const [userTrades, setUserTrades] = useState<Trade[]>([]);
  // Real (on-chain) user wallets only — demo wallets have synthetic
  // pubkeys that 4xx out of fetchTradesBySignerMint. Demo trades are
  // pulled separately below from wallets.demoSummary.
  const realUserPubkeys = useMemo(
    () => userWallets.wallets.filter((w) => w.kind !== "DEMO").map((w) => w.pubkey),
    [userWallets.wallets],
  );
  const realUserPubkeysKey = useMemo(
    () => [...realUserPubkeys].sort().join(","),
    [realUserPubkeys],
  );
  useEffect(() => {
    if (!mint || realUserPubkeys.length === 0) {
      setUserTrades([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      realUserPubkeys.map((pubkey) =>
        fetchTradesBySignerMint(pubkey, mint, 100)
          .then((res) => (Array.isArray(res?.data) ? res.data : []))
          .catch(() => [] as Trade[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      setUserTrades(lists.flat());
    });
    return () => { cancelled = true; };
  }, [mint, realUserPubkeysKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo wallet trades on this mint. Sourced from wallets.demoSummary
  // (DB-backed) and converted to the Trade shape so they merge into the
  // chartMarks and TradesTable pipelines uniformly with real fills.
  const backendClientForDemo = useBackend();
  const activeDemoWallet = useMemo(
    () => userWallets.activeWallets.find((w) => w.kind === "DEMO") ?? null,
    [userWallets.activeWallets],
  );
  const [demoTrades, setDemoTrades] = useState<Trade[]>([]);
  useEffect(() => {
    if (!mint || !activeDemoWallet) { setDemoTrades([]); return; }
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await backendClientForDemo.demoSummary(activeDemoWallet.id);
        if (cancelled) return;
        // Demo executions now carry per-fill tokensAmount + priceSolPerToken
        // (populated at execute time). Use those directly so the row
        // numbers reflect the actual fill, not the current holding state.
        // Falls back to back-computing for any legacy executions written
        // before the snapshot fields landed.
        const holding = s.holdings.find((h) => h.mint === mint);
        const fallbackEntry = holding?.entryPriceSol ?? 0;
        const fallbackTotal = holding?.tokens ?? 0;
        const out: Trade[] = [];
        for (const t of s.trades) {
          if (t.mint !== mint) continue;
          const fillPrice = t.priceSolPerToken ?? fallbackEntry;
          let tokensAmount = t.tokensAmount ?? 0;
          let solAmount = 0;
          if (t.side === "buy") {
            solAmount = t.amountSol ?? 0;
            if (tokensAmount <= 0) {
              tokensAmount = fillPrice > 0 ? solAmount / fillPrice : 0;
            }
          } else {
            if (t.amountSol != null) {
              solAmount = t.amountSol;
            }
            if (tokensAmount <= 0) {
              const pct = (t.sellPct ?? 0) / 100;
              tokensAmount = fallbackTotal * pct;
            }
            if (solAmount <= 0) {
              solAmount = tokensAmount * fillPrice;
            }
          }
          out.push({
            signature: t.signature ?? t.id,
            tokenMint: t.mint,
            signer: activeDemoWallet.pubkey,
            transactionType: t.side,
            tokensAmount,
            avgPrice: fillPrice,
            solAmount,
            timestamp: Date.parse(t.createdAt),
          });
        }
        setDemoTrades(out);
      } catch { /* swallow — next tick retries */ }
    };
    void refresh();
    const offEvent = onDemoChanged(() => { if (!cancelled) void refresh(); });
    const iv = setInterval(refresh, 6_000);
    return () => { cancelled = true; offEvent(); clearInterval(iv); };
  }, [mint, activeDemoWallet, backendClientForDemo]);

  // Trades for the wallet currently driving the Transactions filter. Cleared
  // when the filter is cleared; refetched when it changes. Classified as
  // kind="filtered" so they render with their own color on the chart.
  const [filteredTrades, setFilteredTrades] = useState<Trade[]>([]);
  useEffect(() => {
    if (!filterSigner || !mint) {
      setFilteredTrades([]);
      return;
    }
    let cancelled = false;
    fetchTradesBySignerMint(filterSigner, mint, 100)
      .then((res) => {
        if (cancelled) return;
        setFilteredTrades(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setFilteredTrades([]);
      });
    return () => { cancelled = true; };
  }, [filterSigner, mint]);

  const chartMarks = useMemo<TradeMark[]>(() => {
    // Merge the live trade feed with the dev-specific and filtered-wallet
    // histories, de-duped by (signature, wallet), then classify each trade. Filter
    // wins over dev/user/tracked so the active filter stands out visually.
    const seen = new Set<string>();
    const merged: Trade[] = [];
    const push = (t: Trade) => {
      const key = tradeKey(t);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(t);
    };
    for (const t of trades) push(t);
    for (const t of devTrades) push(t);
    for (const t of userTrades) push(t);
    for (const t of demoTrades) push(t);
    for (const t of filteredTrades) push(t);

    const out: TradeMark[] = [];
    for (const t of merged) {
      let kind: MarkKind | null = null;
      if (filterSigner && t.signer === filterSigner) kind = "filtered";
      else if (devSigner && t.signer === devSigner) kind = "dev";
      else if (userAddrs.has(t.signer)) kind = "user";
      else if (watchAddrs.has(t.signer)) kind = "tracked";
      if (!kind) continue;
      const raw = t.timestamp;
      const ts =
        typeof raw === "number"
          ? raw > 1e12 ? raw : raw * 1000
          : raw ? new Date(raw).getTime() : 0;
      if (!ts) continue;
      // Price converted to the chart's current y-axis scale so the
      // horizontal line sits at the same level as the candle body at the
      // trade's timestamp. See TVChart datafeed `_multiplier`.
      const avg = Number(t.avgPrice) || 0;
      const solPx = solPrice ?? 0;
      const sup = supply || 1;
      const price = avg > 0
        ? solPriceToChartAxis(avg, {
            currency: chartCurrency,
            display: chartDisplay,
            solPrice: solPx,
            supply: sup,
          })
        : undefined;
      out.push({
        id: tradeKey(t),
        time: ts,
        kind,
        side: t.transactionType === "buy" ? "buy" : "sell",
        price: price && Number.isFinite(price) ? price : undefined,
        // Weight for the volume-weighted avg line — 0.01 SOL contributes
        // less than 100 SOL, as it should.
        solAmount: Number.isFinite(t.solAmount) ? Number(t.solAmount) : 0,
      });
    }
    return out;
  }, [
    trades, devTrades, userTrades, demoTrades, filteredTrades,
    devSigner, filterSigner, userAddrs, watchAddrs,
    solPrice, supply, chartCurrency, chartDisplay,
  ]);

  const topHolderChartLines = useMemo(() => {
    const { avgBuySol, avgSellSol } = computeTop10HolderAvgPrices(holders);
    const solPx = solPrice ?? 0;
    const sup = supply || 1;
    const axisOpts = {
      currency: chartCurrency,
      display: chartDisplay,
      solPrice: solPx,
      supply: sup,
    };
    const buy = avgBuySol != null ? solPriceToChartAxis(avgBuySol, axisOpts) : undefined;
    const sell = avgSellSol != null ? solPriceToChartAxis(avgSellSol, axisOpts) : undefined;
    if (buy == null && sell == null) return undefined;
    return { buy, sell };
  }, [holders, solPrice, supply, chartCurrency, chartDisplay]);

  const top10Pct = top10HoldPct(holders, supply > 0 ? supply : undefined);

  // Build bundle/sniper signer sets from the live trade feed for holder flagging
  const bundleSigners = useMemo(
    () => new Set(trades.filter((t) => t.isBundle).map((t) => t.signer)),
    [trades]
  );
  const sniperSigners = useMemo(
    () => new Set(trades.filter((t) => t.isSniper).map((t) => t.signer)),
    [trades]
  );

  const handleAddressClick = useCallback((addr: string) => {
    setWalletQuery(addr);
    setFilterSigner(addr);
    setActiveCat(null);
    setTab("trades");
  }, []);

  const handleClearFilter = useCallback(() => {
    setWalletQuery("");
    setFilterSigner(null);
  }, []);

  const handleWalletFilterSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const next = walletQuery.trim();
    setFilterSigner(next || null);
    if (next) setActiveCat(null);
    setTab("trades");
  }, [walletQuery]);

  const [searchFocused, setSearchFocused] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<Tab | null>(null);
  // On phones the inline wallet-filter input doesn't fit in the 38px tab bar,
  // so it's collapsed to a "Filter" button that opens a bottom-sheet with the
  // same form.
  const [walletFilterModalOpen, setWalletFilterModalOpen] = useState(false);
  const [instantTradeOpen, setInstantTradeOpen] = useUserPreference<boolean>(PREF_KEYS.floatingOpen, false);
  const [tradesSidebarVisible, setTradesSidebarVisible] = useUserPreference<boolean>("token.tradesSidebar.v1", true);
  const toggleTradesSidebar = useCallback(() => setTradesSidebarVisible((v) => !v), [setTradesSidebarVisible]);
  // On mobile the live-trades tape never sits beside the chart (it would steal
  // the chart's width); it's hidden by default and, when toggled on, stacks
  // full-width below the chart. `mobileTradesSidebarOpen` mirrors the user's
  // toggle but starts closed regardless of the persisted desktop preference.
  const [mobileTradesSidebarOpen, setMobileTradesSidebarOpen] = useState(false);
  const toggleMobileTradesSidebar = useCallback(() => setMobileTradesSidebarOpen((v) => !v), []);
  const [amountFilterOpen, setAmountFilterOpen] = useState(false);
  const [amountMinInput, setAmountMinInput] = useState<string>("");
  const [amountMaxInput, setAmountMaxInput] = useState<string>("");
  const [amountFilterCurrency, setAmountFilterCurrency] = useState<"sol" | "usd">("sol");
  const amountFilterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!amountFilterOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!amountFilterRef.current?.contains(e.target as Node)) setAmountFilterOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [amountFilterOpen]);
  const amountMinSol = useMemo(() => {
    const n = parseFloat(amountMinInput);
    if (!isFinite(n) || n < 0) return null;
    if (amountFilterCurrency === "usd") return solPrice && solPrice > 0 ? n / solPrice : null;
    return n;
  }, [amountMinInput, amountFilterCurrency, solPrice]);
  const amountMaxSol = useMemo(() => {
    const n = parseFloat(amountMaxInput);
    if (!isFinite(n) || n < 0) return null;
    if (amountFilterCurrency === "usd") return solPrice && solPrice > 0 ? n / solPrice : null;
    return n;
  }, [amountMaxInput, amountFilterCurrency, solPrice]);
  const amountFilterActive = amountMinSol != null || amountMaxSol != null;

  const [timestampMinMs, setTimestampMinMs] = useState<number | null>(null);
  const [timestampMaxMs, setTimestampMaxMs] = useState<number | null>(null);

  const handleTimestampRangeChange = useCallback(
    (range: { minMs: number | null; maxMs: number | null }) => {
      setTimestampMinMs(range.minMs);
      setTimestampMaxMs(range.maxMs);
    },
    [],
  );

  const handleFilterTimestampFromChart = useCallback(
    (range: { minMs: number; maxMs: number }) => {
      setTimestampMinMs(range.minMs);
      setTimestampMaxMs(range.maxMs);
      setTab("trades");
    },
    [],
  );

  // DEV / TRACKED / YOU — single-select dropdown on the Transactions tab.
  // One category at a time; union of that category's signers is applied
  // client-side on top of whatever TradesTable has fetched.
  const [activeCat, setActiveCat] = useState<TradeCat | null>(null);
  const selectCat = useCallback((c: TradeCat | null) => {
    // Category filter is mutually exclusive with wallet search.
    setFilterSigner(null);
    setWalletQuery("");
    setActiveCat(c);
  }, []);

  const categorySigners = useMemo<Set<string> | null>(() => {
    if (!activeCat) return null;
    const s = new Set<string>();
    if (activeCat === "dev" && devSigner) s.add(devSigner);
    else if (activeCat === "tracked") watchAddrs.forEach((a) => s.add(a));
    else if (activeCat === "you") userAddrs.forEach((a) => s.add(a));
    return s.size > 0 ? s : null;
  }, [activeCat, devSigner, watchAddrs, userAddrs]);

  // When the category selection narrows to exactly one wallet (the common
  // case for DEV) switch TradesTable's server fetch to that signer. The
  // /trades/signer/<addr>/mint/<mint> endpoint returns every trade that
  // wallet has done on this mint with proper pagination — so "DEV" no
  // longer shows only what happens to be in the last 50 live feed rows.
  // The explicit wallet-search filter (filterSigner) still wins when set.
  const effectiveSigner = useMemo<string | null>(() => {
    if (filterSigner) return filterSigner;
    if (categorySigners && categorySigners.size === 1) {
      return Array.from(categorySigners)[0];
    }
    return null;
  }, [filterSigner, categorySigners]);

  // Wallet-filter field group. Rendered inline in the tab bar on desktop and,
  // on phones, inside a bottom-sheet Modal (opened by a compact "Filter"
  // button). `fullWidth` makes the input span the sheet. The submit/clear
  // logic and all state are identical in both placements.
  const renderWalletFilterForm = (fullWidth: boolean) => (
    <form
      onSubmit={(e) => { handleWalletFilterSubmit(e); if (fullWidth) setWalletFilterModalOpen(false); }}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        alignItems: "center",
        minWidth: 0,
        width: fullWidth ? "100%" : undefined,
        paddingLeft: fullWidth ? 0 : 10,
        paddingTop: 6,
        paddingBottom: 6,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          width: fullWidth ? "100%" : 260,
          height: 26,
          padding: "0 8px 0 10px",
          borderRadius: 6,
          border: `1px solid ${
            filterSigner
              ? "color-mix(in oklch, var(--accent) 50%, transparent)"
              : searchFocused
              ? "color-mix(in oklch, var(--accent) 40%, transparent)"
              : "var(--line-soft)"
          }`,
          background: "var(--ink-0)",
          boxShadow: filterSigner
            ? "0 0 0 3px color-mix(in oklch, var(--accent) 8%, transparent)"
            : searchFocused
            ? "0 0 0 3px color-mix(in oklch, var(--accent) 6%, transparent)"
            : "inset 0 1px 0 color-mix(in oklch, black 20%, transparent)",
          transition: "border-color 120ms ease, box-shadow 120ms ease",
        }}
      >
        <span
          style={{
            color: filterSigner || searchFocused ? "var(--accent)" : "var(--paper-4)",
            display: "inline-flex",
            flexShrink: 0,
            transition: "color 120ms ease",
          }}
        >
          {Icon.search(11)}
        </span>
        <Tooltip content={filterSigner ?? null} mono>
          <input
            value={walletQuery}
            onChange={(e) => setWalletQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Filter by wallet…"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--paper)",
              fontSize: 11.5,
              fontWeight: 500,
              letterSpacing: 0.2,
              fontFamily: "var(--font-mono, inherit)",
              padding: 0,
            }}
          />
        </Tooltip>
        {(filterSigner || walletQuery) ? (
          <Tooltip content={filterSigner ? "Clear filter" : "Clear"}>
            <button
              type="button"
              onClick={handleClearFilter}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--paper-3)",
                width: 16,
                height: 16,
                border: "none",
                borderRadius: 4,
                background: "color-mix(in oklch, var(--ink-3) 70%, transparent)",
                padding: 0,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {Icon.close(10)}
            </button>
          </Tooltip>
        ) : (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 16,
              padding: "0 5px",
              borderRadius: 3,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: 0.4,
              color: "var(--paper-4)",
              background: "color-mix(in oklch, var(--ink-2) 70%, transparent)",
              border: "1px solid var(--line-soft)",
              fontFamily: "var(--font-mono, inherit)",
              flexShrink: 0,
            }}
          >
            ⏎
          </span>
        )}
        <button type="submit" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
      </div>
    </form>
  );

  // The /deploy preview (signalled by bottomPanel) is a token that doesn't exist
  // yet, so "My Orders" and "Top Traders" have nothing to show — drop them there.
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "trades", label: bottomPanel?.label ?? "Transactions" },
    ...(bottomPanel ? [] : [{ id: "orders" as Tab, label: "My Orders" }]),
    { id: "holders", label: "Top Holders" },
    ...(bottomPanel ? [] : [{ id: "traders" as Tab, label: "Top Traders" }]),
    { id: "bubblemap", label: "Bubblemap" },
  ];

  // ── Shared sub-panel: transaction tabs + content ─────────────────────────
  // Rendered on desktop (in the left column) and on mobile (in the
  // "Transactions" section). Extracted here to avoid duplicating ~120 lines.
  const renderTransactionsPanel = () => (
    <div style={{
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
      overflow: "hidden",
      background: "var(--ink-1)",
    }}>
      <div style={{
        display: "flex", alignItems: "stretch", gap: 0,
        flexWrap: "nowrap",
        padding: "0 8px",
        borderBottom: "1px solid var(--line-soft)",
        background: "linear-gradient(180deg, var(--ink-1), color-mix(in oklch, var(--ink-1) 92%, black))",
        flexShrink: 0,
        height: 38, minHeight: 38,
        overflowX: "auto",
      }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          const hovered = hoveredTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              onMouseEnter={() => setHoveredTab(t.id)}
              onMouseLeave={() => setHoveredTab(null)}
              style={{
                position: "relative",
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "0 14px",
                background: "transparent",
                border: "none",
                flexShrink: 0,
                color: active ? "var(--paper)" : hovered ? "var(--paper-2)" : "var(--paper-3)",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                letterSpacing: 0.1,
                cursor: "pointer",
                transition: "color 120ms ease",
              }}
            >
              {t.label}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 10, right: 10, bottom: -1,
                  height: 2, borderRadius: "2px 2px 0 0",
                  background: active ? "var(--accent)" : "transparent",
                  boxShadow: active
                    ? "0 0 8px color-mix(in oklch, var(--accent) 40%, transparent)"
                    : "none",
                  transition: "background 120ms ease",
                }}
              />
            </button>
          );
        })}
        {/* Instant Trade — hidden on /deploy preview */}
        {!bottomPanel && !isMobile && (
        <button
          type="button"
          onClick={() => setInstantTradeOpen(!instantTradeOpen)}
          title={instantTradeOpen ? "Close instant trade panel" : "Open instant trade panel"}
          style={{
            alignSelf: "center",
            marginLeft: 12,
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 12px",
            height: 26,
            background: instantTradeOpen
              ? "color-mix(in oklch, var(--accent) 16%, transparent)"
              : "color-mix(in oklch, var(--accent) 10%, transparent)",
            border: `1px solid var(--accent)`,
            borderRadius: 999,
            color: "var(--accent)",
            fontSize: 12, fontWeight: 600,
            letterSpacing: 0.1,
            cursor: "pointer",
            transition: "background 120ms ease",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 22%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = instantTradeOpen
              ? "color-mix(in oklch, var(--accent) 16%, transparent)"
              : "color-mix(in oklch, var(--accent) 10%, transparent)";
          }}
        >
          {Icon.bolt(12)}
          <span>Instant Trade</span>
        </button>
        )}
        {tab === "trades" && !bottomPanel && (
          <div style={{ marginLeft: "auto" }}>
            <TradeCategoryFilter
              categories={["dev", "tracked", "you"] as const}
              labels={CAT_LABEL}
              active={activeCat}
              onChange={selectCat}
              isDisabled={(c) =>
                (c === "dev" && !devSigner) ||
                (c === "tracked" && watchAddrs.size === 0) ||
                (c === "you" && userAddrs.size === 0)
              }
            />
          </div>
        )}
        {tab === "trades" && !bottomPanel && !isPhone && renderWalletFilterForm(false)}
        {tab === "trades" && !bottomPanel && isPhone && (
          <button
            type="button"
            onClick={() => setWalletFilterModalOpen(true)}
            className="tap-target"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              alignSelf: "center",
              marginLeft: 8,
              height: 26,
              padding: "0 10px",
              background: filterSigner
                ? "color-mix(in oklch, var(--accent) 14%, transparent)"
                : "var(--ink-0)",
              border: `1px solid ${filterSigner
                ? "color-mix(in oklch, var(--accent) 50%, transparent)"
                : "var(--line-soft)"}`,
              borderRadius: 999,
              color: filterSigner ? "var(--accent)" : "var(--paper-3)",
              fontSize: 11, fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {Icon.search(11)}
            <span>{filterSigner ? "Filtered" : "Filter"}</span>
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Suspense fallback={<LazyFallback />}>
        {tab === "trades" && bottomPanel && bottomPanel.node}
        {tab === "trades" && !bottomPanel && (
          <TradesTable
            solPrice={solPrice ?? 0}
            supply={supply}
            currency={tradesCurrency}
            display={tradesDisplay}
            onCurrencyChange={onTradesCurrencyChange}
            onDisplayChange={onTradesDisplayChange}
            signer={effectiveSigner}
            devSigner={devSigner}
            categorySigners={categorySigners}
            amountMinSol={amountMinSol}
            amountMaxSol={amountMaxSol}
            timestampMinMs={timestampMinMs}
            timestampMaxMs={timestampMaxMs}
            onTimestampRangeChange={handleTimestampRangeChange}
            extraTrades={demoTrades}
            renderTotalHeaderSlot={() => (
              <span ref={amountFilterRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setAmountFilterOpen((v) => !v); }}
                  title={amountFilterActive ? "Edit amount filter" : "Filter trades by amount"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    height: 22,
                    padding: "0 8px",
                    background: amountFilterActive
                      ? "color-mix(in oklch, var(--accent) 14%, transparent)"
                      : "var(--ink-0)",
                    border: `1px solid ${amountFilterActive
                      ? "color-mix(in oklch, var(--accent) 50%, transparent)"
                      : "var(--line-soft)"}`,
                    borderRadius: 999,
                    color: amountFilterActive ? "var(--accent)" : "var(--paper-3)",
                    fontSize: 10, fontWeight: 600,
                    letterSpacing: 0.4,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    transition: "background 120ms, border-color 120ms, color 120ms",
                  }}
                >
                  <FilterAmountIcon size={10} />
                  <span>Amount</span>
                  {amountFilterActive && (
                    <span style={{
                      marginLeft: 1,
                      padding: "0 5px",
                      borderRadius: 999,
                      fontSize: 9,
                      fontWeight: 700,
                      background: "color-mix(in oklch, var(--accent) 25%, transparent)",
                      color: "var(--accent)",
                      fontFamily: "var(--font-mono, inherit)",
                      letterSpacing: 0,
                    }}>
                      {amountMinInput || "0"}–{amountMaxInput || "∞"} {amountFilterCurrency === "sol" ? nativeSymbol(getActiveChain()) : "$"}
                    </span>
                  )}
                </button>
                {amountFilterOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      zIndex: 50,
                      width: 244,
                      maxWidth: viewportMaxWidth(),
                      padding: 10,
                      background: "var(--ink-1)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      boxShadow: "0 8px 32px color-mix(in oklch, black 50%, transparent)",
                      display: "flex", flexDirection: "column", gap: 8,
                      textTransform: "none",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      fontSize: 10, fontWeight: 600, letterSpacing: 0.4,
                      color: "var(--paper-3)", textTransform: "uppercase",
                    }}>
                      <span>Amount filter</span>
                      <div style={{
                        display: "inline-flex",
                        background: "var(--ink-0)",
                        border: "1px solid var(--line-soft)",
                        borderRadius: 999,
                        padding: 2,
                        gap: 2,
                      }}>
                        {(["sol", "usd"] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setAmountFilterCurrency(c)}
                            style={{
                              padding: "2px 8px",
                              fontSize: 10, fontWeight: 700,
                              border: 0, borderRadius: 999,
                              cursor: "pointer",
                              color: amountFilterCurrency === c ? "var(--ink-0)" : "var(--paper-3)",
                              background: amountFilterCurrency === c ? "var(--paper)" : "transparent",
                              transition: "background 120ms, color 120ms",
                              letterSpacing: 0.2,
                            }}
                          >{c === "sol" ? nativeSymbol(getActiveChain()) : "$ USD"}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <label style={amountFieldLabelStyle}>
                        <span style={amountFieldHintStyle}>MIN</span>
                        <input
                          value={amountMinInput}
                          onChange={(e) => setAmountMinInput(e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="0"
                          inputMode="decimal"
                          style={amountFieldInputStyle}
                        />
                      </label>
                      <label style={amountFieldLabelStyle}>
                        <span style={amountFieldHintStyle}>MAX</span>
                        <input
                          value={amountMaxInput}
                          onChange={(e) => setAmountMaxInput(e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="∞"
                          inputMode="decimal"
                          style={amountFieldInputStyle}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => { setAmountMinInput(""); setAmountMaxInput(""); }}
                        disabled={!amountMinInput && !amountMaxInput}
                        style={{
                          padding: "5px 10px",
                          fontSize: 11, fontWeight: 600,
                          background: "transparent",
                          border: "1px solid var(--line-soft)",
                          borderRadius: 6,
                          color: (!amountMinInput && !amountMaxInput) ? "var(--paper-4)" : "var(--paper-2)",
                          cursor: (!amountMinInput && !amountMaxInput) ? "not-allowed" : "pointer",
                        }}
                      >Clear</button>
                      <button
                        type="button"
                        onClick={() => setAmountFilterOpen(false)}
                        style={{
                          padding: "5px 12px",
                          fontSize: 11, fontWeight: 700,
                          background: "var(--accent)",
                          border: 0,
                          borderRadius: 6,
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >Done</button>
                    </div>
                  </div>
                )}
              </span>
            )}
            onAddressClick={handleAddressClick}
          />
        )}
        {tab === "holders" && (
          <HoldersTable
            solPrice={solPrice ?? 0}
            bundleSigners={bundleSigners}
            sniperSigners={sniperSigners}
            onAddressClick={handleAddressClick}
          />
        )}
        {tab === "traders" && (
          <TopTradersTable
            solPrice={solPrice ?? 0}
            supply={supply}
            onAddressClick={handleAddressClick}
          />
        )}
        {tab === "orders" && (
          <MyOrdersTab
            orders={limitOrders.orders}
            loading={limitOrders.loading}
            error={limitOrders.error}
            marketCap={liveMarketCap}
            onCancel={handleOrderLineCancel}
          />
        )}
        {tab === "bubblemap" && (
          <BubblemapPanel
            addresses={holders.slice(0, 100).map((h) => h.address)}
            holders={holders.slice(0, 100)}
            mint={mint}
            onWalletClick={handleAddressClick}
          />
        )}
        </Suspense>
      </div>
    </div>
  );

  // ── Mobile layout: three-tab bottom nav ───────────────────────────────────
  if (isMobile) {
    const MOBILE_TABS: Array<{ id: MobileSection; label: string; icon: React.ReactNode }> = [
      {
        id: "chart",
        label: "Chart",
        icon: (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="10" width="3" height="8" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="7" y="5" width="3" height="13" rx="1" fill="currentColor" />
            <rect x="12" y="7" width="3" height="11" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="17" y="3" width="1" height="15" rx="0.5" fill="currentColor" opacity="0.25" />
            <path d="M3.5 9 L8.5 4.5 L13.5 6.5 L18 2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        ),
      },
      {
        id: "transactions",
        label: "Transactions",
        icon: (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="16" height="2" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="2" y="9" width="12" height="2" rx="1" fill="currentColor" />
            <rect x="2" y="14" width="14" height="2" rx="1" fill="currentColor" opacity="0.7" />
          </svg>
        ),
      },
      {
        id: "trading",
        label: "Trading",
        icon: (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 14 L10 5 L15 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10" cy="5" r="1.5" fill="var(--buy)" />
            <path d="M4 16 L16 16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
          </svg>
        ),
      },
    ];

    return (
      <div style={{
        display: "flex", flexDirection: "column",
        height: "100%",
        background: "var(--ink-0)",
      }}>
        <TokenHeader
          mint={mint}
          top10Pct={top10Pct > 0 ? top10Pct : undefined}
          solPrice={solPrice ?? 0}
          supply={supply}
          showClone={!hideHeaderClone}
          celebrationReserveSidePanel={{
            side: sidePanelSide,
            width: sidePanelWidth ?? TRADING_PANEL_WIDTH,
          }}
        />

        {/* Section area — fills between header and bottom tab bar */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* ── Chart ── */}
          {mobileSection === "chart" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <TVChart
                  currency={chartCurrency}
                  display={chartDisplay}
                  onCurrencyChange={onChartCurrencyChange}
                  onDisplayChange={onChartDisplayChange}
                  marks={chartMarks}
                  migratedAt={info?.migrated_at ?? null}
                  solPrice={solPrice}
                  supply={supply}
                  orderLines={activeOrderLines}
                  onOrderLineDrag={handleOrderLineDrag}
                  onOrderLineCancel={handleOrderLineCancel}
                  topHolderLines={topHolderChartLines}
                  onFilterTimestamp={(range) => {
                    handleFilterTimestampFromChart(range);
                    setMobileSection("transactions");
                  }}
                  rightPanelVisible={mobileTradesSidebarOpen}
                  onToggleRightPanel={sidePanel ? undefined : toggleMobileTradesSidebar}
                />
              </div>
              {!sidePanel && mobileTradesSidebarOpen && (
                <div style={{ maxHeight: 280, display: "flex", borderTop: "1px solid var(--line-soft)", flexShrink: 0 }}>
                  <TokenTradesSidebar
                    trades={trades}
                    solPrice={solPrice ?? 0}
                    supply={supply}
                    loading={tradesLoading}
                    currency={tradesCurrency}
                    onCurrencyChange={onTradesCurrencyChange}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Transactions ── */}
          {mobileSection === "transactions" && renderTransactionsPanel()}

          {/* ── Trading ── */}
          {mobileSection === "trading" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <Suspense fallback={<LazyFallback />}>
                <PriceChangeStrip mint={mint} />
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                  {sidePanel ?? <TradingPanel mint={mint} />}
                </div>
              </Suspense>
            </div>
          )}
        </div>

        {/* ── Bottom tab bar ── */}
        <div style={{
          flexShrink: 0,
          display: "flex",
          borderTop: "1px solid var(--line-soft)",
          background: "var(--ink-1)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
          {MOBILE_TABS.map(({ id, label, icon }) => {
            const active = mobileSection === id;
            return (
              <button
                key={id}
                onClick={() => setMobileSection(id)}
                style={{
                  flex: 1,
                  position: "relative",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 3,
                  padding: "10px 4px",
                  border: "none",
                  background: "transparent",
                  color: active ? "var(--accent)" : "var(--paper-4)",
                  cursor: "pointer",
                  transition: "color 160ms ease",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {icon}
                <span style={{
                  fontSize: 10, fontWeight: active ? 700 : 500,
                  letterSpacing: "0.02em",
                  lineHeight: 1,
                }}>
                  {label}
                </span>
                {active && (
                  <span style={{
                    position: "absolute",
                    top: 0,
                    left: "15%", right: "15%",
                    height: 2,
                    background: "var(--accent)",
                    borderRadius: "0 0 2px 2px",
                    boxShadow: "0 0 6px color-mix(in oklch, var(--accent) 60%, transparent)",
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Wallet-filter bottom sheet */}
        {isPhone && (
          <Modal
            open={walletFilterModalOpen}
            onClose={() => setWalletFilterModalOpen(false)}
            mobileVariant="sheet"
            width={420}
          >
            <ModalHeader title="Filter by wallet" onClose={() => setWalletFilterModalOpen(false)} />
            <div style={{ padding: "16px 20px calc(16px + var(--safe-b))", display: "flex", flexDirection: "column", gap: 12, background: "var(--ink-1)", overflow: "auto" }}>
              {renderWalletFilterForm(true)}
            </div>
            <ModalFooter>
              {(filterSigner || walletQuery) && (
                <Btn size="sm" onClick={() => { handleClearFilter(); }}>Clear</Btn>
              )}
              <Btn size="sm" tone="primary" onClick={() => { handleWalletFilterSubmit(); setWalletFilterModalOpen(false); }}>Apply</Btn>
            </ModalFooter>
          </Modal>
        )}
      </div>
    );
  }

  // ── Desktop layout (unchanged) ────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
        flex: 1, minHeight: 0,
        background: "var(--ink-0)",
      }}
    >
      {isResizing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            cursor: "row-resize",
          }}
        />
      )}
      <TokenHeader
        mint={mint}
        top10Pct={top10Pct > 0 ? top10Pct : undefined}
        solPrice={solPrice ?? 0}
        supply={supply}
        showClone={!hideHeaderClone}
        celebrationReserveSidePanel={{
          side: sidePanelSide,
          width: sidePanelWidth ?? TRADING_PANEL_WIDTH,
        }}
      />

      <div style={{
        display: "flex", flex: 1,
        flexDirection: sidePanelSide === "left" ? "row-reverse" : "row",
        overflow: "hidden", minHeight: 0,
      }}>
        <div
          ref={leftColRef}
          style={{
            display: "flex", flexDirection: "column", flex: 1,
            gap: 0, minWidth: 0, minHeight: 0,
          }}
        >
          <div style={{
            display: "flex", flexDirection: "row",
            flex: `0 0 ${chartHeight}px`, minHeight: CHART_MIN,
            minWidth: 0,
          }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <TVChart
                currency={chartCurrency}
                display={chartDisplay}
                onCurrencyChange={onChartCurrencyChange}
                onDisplayChange={onChartDisplayChange}
                marks={chartMarks}
                migratedAt={info?.migrated_at ?? null}
                solPrice={solPrice}
                supply={supply}
                orderLines={activeOrderLines}
                onOrderLineDrag={handleOrderLineDrag}
                onOrderLineCancel={handleOrderLineCancel}
                topHolderLines={topHolderChartLines}
                onFilterTimestamp={handleFilterTimestampFromChart}
                rightPanelVisible={tradesSidebarVisible}
                onToggleRightPanel={sidePanel ? undefined : toggleTradesSidebar}
              />
            </div>
            {!sidePanel && tradesSidebarVisible && (
              <>
                <div style={{ width: 1, background: "var(--line-soft)", flexShrink: 0 }} />
                <TokenTradesSidebar
                  trades={trades}
                  solPrice={solPrice ?? 0}
                  supply={supply}
                  loading={tradesLoading}
                  currency={tradesCurrency}
                  onCurrencyChange={onTradesCurrencyChange}
                />
              </>
            )}
          </div>

          <div
            onMouseDown={onResizeStart}
            role="separator"
            aria-orientation="horizontal"
            style={{
              flex: "0 0 5px",
              height: 5,
              cursor: "row-resize",
              background: "var(--line-soft)",
              position: "relative",
            }}
          >
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              transform: "translate(-50%, -50%)",
              width: 32, height: 1,
              background: "var(--paper-4)",
              opacity: 0.5,
            }} />
          </div>

          {renderTransactionsPanel()}
        </div>

        <div style={{
          width: 1, background: "var(--line-soft)", flexShrink: 0,
        }} />

        <div style={{
          display: "flex", flexDirection: "column",
          width: sidePanelWidth ?? TRADING_PANEL_WIDTH, flexShrink: 0, minHeight: 0,
        }}>
          {sidePanel ? (
            sidePanel
          ) : (
            <Suspense fallback={<LazyFallback />}>
              <PriceChangeStrip mint={mint} />
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <TradingPanel mint={mint} />
              </div>
            </Suspense>
          )}
        </div>
      </div>

      {/* Phone-only wallet-filter bottom sheet */}
      {isPhone && (
        <Modal
          open={walletFilterModalOpen}
          onClose={() => setWalletFilterModalOpen(false)}
          mobileVariant="sheet"
          width={420}
        >
          <ModalHeader title="Filter by wallet" onClose={() => setWalletFilterModalOpen(false)} />
          <div style={{ padding: "16px 20px calc(16px + var(--safe-b))", display: "flex", flexDirection: "column", gap: 12, background: "var(--ink-1)", overflow: "auto" }}>
            {renderWalletFilterForm(true)}
          </div>
          <ModalFooter>
            {(filterSigner || walletQuery) && (
              <Btn size="sm" onClick={() => { handleClearFilter(); }}>Clear</Btn>
            )}
            <Btn size="sm" tone="primary" onClick={() => { handleWalletFilterSubmit(); setWalletFilterModalOpen(false); }}>Apply</Btn>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

import type { LimitOrderView } from "../../hooks/useLimitOrders";

function LazyFallback() {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 60, background: "var(--ink-0)",
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24"
        style={{ animation: "lazy-spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--line)" strokeWidth="2" />
        <path d="M12 2 A10 10 0 0 1 22 12" fill="none"
          stroke="var(--paper-3)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <style>{`@keyframes lazy-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function FilterAmountIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const amountFieldLabelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex", flexDirection: "column", gap: 3,
};

const amountFieldHintStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
  color: "var(--paper-4)",
};

const amountFieldInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12, fontWeight: 500,
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 5,
  color: "var(--paper)",
  outline: "none",
  fontFamily: "var(--font-mono, inherit)",
};

function MyOrdersTab({
  orders,
  loading,
  error,
  marketCap,
  onCancel,
}: {
  orders: LimitOrderView[];
  loading: boolean;
  error: string | null;
  marketCap: number | null;
  onCancel: (id: string) => void;
}) {
  if (loading && orders.length === 0) {
    return (
      <div style={{
        padding: 24, textAlign: "center",
        fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
      }}>
        Loading orders…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{
        padding: 24, textAlign: "center",
        fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--sell)",
      }}>
        {error}
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div style={{
        padding: 24, textAlign: "center",
        fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
      }}>
        No limit orders for this token.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr 1fr 1fr 60px 28px",
        gap: 0,
        padding: "5px 12px",
        borderBottom: "1px solid var(--line-soft)",
        fontSize: 10, fontFamily: "var(--font-mono)",
        color: "var(--paper-4)", fontWeight: 600, letterSpacing: 0.3,
      }}>
        <span>SIDE</span>
        <span>TARGET MC</span>
        <span>DISTANCE</span>
        <span>AMOUNT</span>
        <span>STATUS</span>
        <span />
      </div>

      {orders.map((o) => {
        const pending = o.status === "active";
        const color = o.side === "buy" ? "var(--buy)" : "var(--sell)";
        const target = o.limitConfig.targetMcapUsd;
        const distance =
          marketCap && marketCap > 0
            ? `${((target / marketCap - 1) * 100).toFixed(1)}%`
            : "—";
        const amountLabel =
          o.side === "buy" ? `${o.amount}◎` : `${o.amount}%`;

        return (
          <div
            key={o.id}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 1fr 1fr 60px 28px",
              gap: 0,
              alignItems: "center",
              padding: "7px 12px",
              borderBottom: "1px solid var(--line-soft)",
              fontSize: 11, fontFamily: "var(--font-mono)",
              color: "var(--paper-2)",
              opacity: pending ? 1 : 0.55,
            }}
          >
            <span style={{ color, fontWeight: 700 }}>{o.side.toUpperCase()}</span>
            <span style={{ color: "var(--paper-3)" }}>${fmtNum(target)}</span>
            <span style={{
              color: pending
                ? parseFloat(distance) > 0 ? "var(--buy)" : "var(--sell)"
                : "var(--paper-4)",
            }}>
              {pending ? distance : "—"}
            </span>
            <span style={{ color: "var(--paper-3)" }}>{amountLabel}</span>
            <span>
              <Pill
                tone={
                  o.status === "filled" ? "buy"
                    : o.status === "failed" || o.status === "cancelled" || o.status === "expired" ? "sell"
                    : "default"
                }
                size="xs"
              >
                {o.status}
              </Pill>
            </span>
            <span>
              {pending && (
                <Tooltip content="Cancel order">
                  <button
                    onClick={() => onCancel(o.id)}
                    style={{
                      background: "transparent", border: 0,
                      color: "var(--paper-4)", cursor: "pointer",
                      fontSize: 14, lineHeight: 1, padding: 2,
                    }}
                    aria-label="Cancel"
                  >×</button>
                </Tooltip>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
