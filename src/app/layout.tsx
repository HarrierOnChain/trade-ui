import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { Shell } from "../components/shell/Shell";

export const metadata: Metadata = {
  title: "Trade UI",
  description: "Self-hosted trading terminal for Raze",
  icons: {
    icon: [{ url: "/logo/raze.svg", type: "image/svg+xml" }],
    shortcut: "/logo/raze.svg",
    apple: "/logo/raze.svg",
  },
  // Make the installed/standalone PWA-style view use the full screen and a
  // sensible title bar on phones.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Trade UI" },
  formatDetection: { telephone: false },
};

// `viewport-fit=cover` lets the layout extend under the notch/home-indicator
// and exposes `env(safe-area-inset-*)` (consumed in globals.css). We do NOT
// pin `maximumScale`/`userScalable` — disabling pinch-zoom is an accessibility
// antipattern, and the terminal's dense numbers benefit from letting users
// zoom in.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a1714",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Token images are served from the API's /media: open the connection
            while the page loads, not when the first icon asks for it. */}
        <link rel="preconnect" href="https://api.raze.bot" />
        <link rel="dns-prefetch" href="https://api.raze.bot" />
      </head>
      <body suppressHydrationWarning>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
