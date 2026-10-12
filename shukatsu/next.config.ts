import type { NextConfig } from "next";
import { resolve } from "node:path";

// The engine (path-resolver, tracker-parse, the upstream CLIs) lives one level
// up, in the career-ops checkout this app is part of, so Turbopack's root is
// the repo root. Personal data is never under it: that's the data root.
const repoRoot = resolve(import.meta.dirname, "..");

const allowedOrigins = (process.env.SHUKATSU_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  experimental: {
    // A tunnel or reverse proxy serves the app under its own host; server
    // actions only accept that host when it's listed here.
    serverActions: { allowedOrigins, bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
