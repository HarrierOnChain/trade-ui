import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { Shell } from "../components/shell/Shell";

export const metadata: Metadata = {
  title: "Trade UI",
  description: "Self-hosted multi-chain trading terminal",
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
        {/* Secure-context polyfill: `crypto.randomUUID` is only defined over
            HTTPS or localhost. When the app is opened over plain HTTP on a raw
            IP (e.g. a dev box for QA), it is missing and Privy throws at
            module-init. Define it from `crypto.getRandomValues` (which works in
            insecure contexts). No-op in production (HTTPS already provides it). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(typeof crypto!=='undefined'&&crypto.getRandomValues&&!crypto.randomUUID){crypto.randomUUID=function(){return'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,function(c){return(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)})}}",
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
