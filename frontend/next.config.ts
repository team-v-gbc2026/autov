import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // page.dev.tsx routes exist only in `next dev`, never in production builds.
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER
    ? ["dev.tsx", "tsx", "ts", "jsx", "js"]
    : ["tsx", "ts", "jsx", "js"],
});

export default nextConfig;
