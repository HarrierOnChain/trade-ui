import type { NextConfig } from "next";
import path from "node:path";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH || process.env.NEXT_BASE_PATH || "";
const basePath = configuredBasePath.replace(/\/$/, "");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // Isolate production output from `next dev` writing into `.next`.
  distDir: process.env.NODE_ENV === "production" ? ".next-prod" : ".next",
  reactStrictMode: false, // Prevent double-mount of the chart widget
  transpilePackages: ["@razedotbot/charts"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.raze.sh" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "**.ipfs.nftstorage.link" },
    ],
  },
  webpack(config) {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { message: /Attempted import error.*@razedotbot\/charts/ },
      { message: /Critical dependency.*@razedotbot\/charts/ },
    ];
    // @privy-io/react-auth v3 lazily `import("@farcaster/mini-app-solana")` for
    // Farcaster mini-app embedding. It's an OPTIONAL peerDependency
    // (peerDependenciesMeta.optional) we deliberately don't install — this is a
    // Solana trading terminal, never a Farcaster mini-app, so that code path is
    // unreachable at runtime. Alias it to an empty module so the optional
    // dynamic import resolves at build time without pulling the dep (and its
    // supply-chain surface).
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@farcaster/mini-app-solana": false,
      "@privy-io/react-auth": path.resolve(__dirname, "src/shims/privy.tsx"),
    };
    return config;
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob:",
              "connect-src 'self' http: https: ws: wss: https://auth.privy.io https://*.privy.io",
              "frame-src 'self' blob: https://auth.privy.io https://*.privy.io https://challenges.cloudflare.com",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
