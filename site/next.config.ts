import type { NextConfig } from "next";

// The product page lives at kaitosoeno.com/shukatsu, served by its own Worker
// on that route (wrangler.jsonc), so every URL it makes starts with /shukatsu.
// It needs nothing from the career-ops checkout around it (prepare.mjs copies
// in what it uses), so Turbopack's root is this folder, not the repo's.
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/shukatsu",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
