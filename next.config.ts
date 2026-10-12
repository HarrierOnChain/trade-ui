import type { NextConfig } from "next";
import path from "node:path";

// No basePath: server.mjs guards `/api/` at the root, so the app is served at
// the root of its host (a subdomain behind a proxy, not a subpath).
const nextConfig: NextConfig = {
  // Isolate production output from `next dev` writing into `.next`.
  distDir: process.env.NODE_ENV === "production" ? ".next-prod" : ".next",
  // A traced, self-contained server for the desktop app and Docker
  // (scripts/bundle-server.mjs). `npm start` from a checkout runs as before.
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname),
  reactStrictMode: false, // Prevent double-mount of the chart widget
  // Charts is a browser widget. Bundling it into the server dev build names a
  // vendor chunk `vendor-chunks/@razedotbot.js` that webpack never writes, so
  // the static-paths worker 500s on /token. Require the published CJS instead.
  serverExternalPackages: ["@razedotbot/charts"],
  // Token images are plain <img> tags from many hosts; no next/image, so no
  // optimizer (and no native image library in the bundle).
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "*": ["node_modules/@img/**", "node_modules/sharp/**", "node_modules/typescript/**"],
  },
  webpack(config) {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { message: /Attempted import error.*@razedotbot\/charts/ },
      { message: /Critical dependency.*@razedotbot\/charts/ },
    ];
    return config;
  },
  // The Wallets page became part of the Portfolio on 2026-10-11.
  async redirects() {
    return [{ source: "/wallets", destination: "/portfolio", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js needs inline scripts; eval only for dev's hot reload.
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              // Token images and metadata live on many hosts (IPFS gateways, CDNs).
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob:",
              "connect-src 'self' https: wss: ws:",
              "frame-src 'self' blob:",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
