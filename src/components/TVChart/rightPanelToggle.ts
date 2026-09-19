// Show/hide toggle for the column that sits to the right of the chart — the
// trades tape on the token page, the orderbook/trades sidebar on perps. Mounted
// directly into the chart header toolbar (createButton returns an
// HTMLElement), placed right after the "Lines" dropdown. Shared by TVChart and
// PerpTVChart so both charts get an identical control.

// Minimal structural type for the bit of the widget we touch — avoids
// pulling the charting type surface into this helper.
type ToolbarHost = {
  createButton(opts: { align: "left" | "right"; useTradingViewStyle: boolean }): HTMLElement;
};

const ACCENT = "#66d89e"; // hover
const ACTIVE = "#f4eee1"; // visible
const DIM = "#555";       // hidden

// A panel glyph: a framed area with a divided right column. The right column
// is filled when the panel is visible, hollow when hidden.
function panelIcon(color: string, on: boolean): string {
  return [
    `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="1.75" y="3" width="12.5" height="10" rx="1.5" stroke="${color}" stroke-width="1.3"/>`,
    `<line x1="10.25" y1="3" x2="10.25" y2="13" stroke="${color}" stroke-width="1.3"/>`,
    on ? `<rect x="10.25" y="3" width="4" height="10" fill="${color}" fill-opacity="0.85"/>` : ``,
    `</svg>`,
  ].join("");
}

/// Mount the toggle button into `tvWidget`'s toolbar.
/// - `getVisible` reads the live visibility (call again on each paint).
/// - `onToggle` flips the parent React state.
/// - `registerPaint` receives a repaint fn the caller can store in a ref so an
///   effect can refresh the icon when the visibility prop changes externally.
export function mountRightPanelToggleButton(
  tvWidget: ToolbarHost,
  tvBtnCss: string,
  getVisible: () => boolean,
  onToggle: () => void,
  registerPaint: (paint: () => void) => void,
) {
  const btn = tvWidget.createButton({ align: "left", useTradingViewStyle: false });
  btn.style.cssText = tvBtnCss;

  let hovered = false;
  const paint = () => {
    const on = getVisible();
    const color = hovered ? ACCENT : on ? ACTIVE : DIM;
    btn.title = on ? "Hide side panel" : "Show side panel";
    btn.innerHTML = panelIcon(color, on);
  };
  paint();

  btn.addEventListener("mouseenter", () => { hovered = true; paint(); });
  btn.addEventListener("mouseleave", () => { hovered = false; paint(); });
  btn.addEventListener("click", (e) => { e.stopPropagation(); onToggle(); });

  registerPaint(paint);
}
