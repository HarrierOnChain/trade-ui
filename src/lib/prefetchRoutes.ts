// Eagerly prefetch all lazy-loaded route chunks in the background so that
// subsequent navigations are instant. Called once from Shell on mount.
// Uses dynamic import() which the bundler code-splits; the browser fetches
// the JS but the modules aren't evaluated until actually rendered.

export function prefetchRoutes() {
  const start = () => {
    // Token page heavy components (React.lazy chunks)
    import("../components/TVChart");
    import("../components/TradesTable");
    import("../components/HoldersTable");
    import("../components/TopTradersTable");
    import("../components/BubblemapPanel");
    import("../components/TradingPanel");
    import("../components/PriceChangeStrip");

    // Next.js page route JS — prefetch via link tags so the router
    // doesn't need to fetch them on navigation.
    const routes = ["/monitor", "/portfolio", "/deploy"];
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
