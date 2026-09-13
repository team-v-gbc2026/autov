import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // page.dev.tsx / route.dev.ts routes exist only in `next dev`, never in
  // production builds. Next matches app-router files as `page.<ext>` /
  // `route.<ext>` against this list, so a `.dev.ts` route handler needs
  // "dev.ts" listed here just as a `.dev.tsx` page needs "dev.tsx".
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER
    ? ["dev.tsx", "dev.ts", "tsx", "ts", "jsx", "js"]
    : ["tsx", "ts", "jsx", "js"],
});

export default nextConfig;
