// Eagerly prefetch all lazy-loaded route chunks in the background so that
// subsequent navigations are instant. Called once from Shell on mount.
// Uses dynamic import() which the bundler code-splits; the browser fetches
// the JS but the modules aren't evaluated until actually rendered.

async function prefetchSwapLogos() {
  const [{ prefetchTokenImages }, { KNOWN_TOKENS }, { quoteMints }, { getActiveChain }] = await Promise.all([
    import("../hooks/useTokenImages"),
    import("../components/SwapCard/tokens"),
    import("./quoteMints"),
    import("./chains"),
  ]);
  const chain = getActiveChain();
  const addresses = chain === "sol"
    ? KNOWN_TOKENS.map((t) => t.mint)
    : quoteMints(chain).map((q) => q.mint ?? "native");
  await prefetchTokenImages(chain, addresses).catch(() => {});
}

export function prefetchRoutes() {
  const start = () => {
    // Token page heavy components (React.lazy chunks)
    import("../components/TVChart");
    import("../components/TradesTable");
    import("../components/HoldersTable");
    import("../components/TopTradersTable");
    import("../components/TradingPanel");
    import("../components/PriceChangeStrip");

    // The swap cards' coin logos (looked up by address, then downloaded), so
    // the Swap page opens with them instead of waiting on two round trips.
    void prefetchSwapLogos();

    // Next.js page route JS — prefetch via link tags so the router
    // doesn't need to fetch them on navigation.
    const routes = ["/discover", "/trenches", "/portfolio", "/swap", "/bundler"];
    for (const href of routes) {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      link.as = "document";
      document.head.appendChild(link);
    }
  };

  // Wait for the current page to settle before competing for bandwidth.
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(start);
  } else {
    setTimeout(start, 2000);
  }
}
