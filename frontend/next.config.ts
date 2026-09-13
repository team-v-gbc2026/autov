import { withEve } from "eve/next";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // page.dev.tsx routes exist only in `next dev`, never in production builds.
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER
    ? ["dev.tsx", "tsx", "ts", "jsx", "js"]
    : ["tsx", "ts", "jsx", "js"],
});

const integratedConfig = withEve(nextConfig);
export default async function config(phase: string, context: { defaultConfig: NextConfig }) {
  const result = await integratedConfig(phase, context);
  // Next 16 serves compiled rewrites in `next start` without evaluating this function.
  // Evaluate once so eve starts its local production service; Vercel starts it itself.
  if (phase === PHASE_PRODUCTION_SERVER && !process.env.VERCEL) await result.rewrites?.();
  return result;
}
