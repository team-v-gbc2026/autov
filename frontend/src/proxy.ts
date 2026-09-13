import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";
import { filterSupabaseCookies } from "@/lib/supabase/auth-cookies";

export async function proxy(request: NextRequest) {
  const { url: supabaseUrl, key } = isSupabaseConfigured() ? supabaseConfig() : { url: "", key: "" };
  let cookiesChanged = false;
  // Only serialize request-header overrides when auth actually changes cookies.
  let response = NextResponse.next();
  if (isSupabaseConfigured()) {
    const supabase = createServerClient(supabaseUrl, key, { cookies: {
      encode: "tokens-only",
      getAll: () => filterSupabaseCookies(request.cookies.getAll(), supabaseUrl),
      setAll(values, headers) {
        values.forEach(({ name, value, options }) => {
          if (options.maxAge === 0) request.cookies.delete(name);
          else request.cookies.set(name, value);
        });
        cookiesChanged = true;
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request: { headers: request.headers } });
        previousCookies.forEach(cookie => response.cookies.set(cookie));
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    } });
    await supabase.auth.getClaims();
  }
  const hostname = request.nextUrl.hostname;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let configuredHost = "";
  try { if (appUrl) configuredHost = new URL(appUrl).hostname; } catch { /* Local route remains available without a domain. */ }
  if ((hostname.startsWith("app.") || hostname === configuredHost) && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    const rewritten = NextResponse.rewrite(url, cookiesChanged ? { request: { headers: request.headers } } : undefined);
    response.cookies.getAll().forEach(cookie => rewritten.cookies.set(cookie));
    rewritten.headers.set("Cache-Control", "private, no-store");
    return rewritten;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/workspace/:path*", "/login", "/auth/:path*", "/api/:path*"] };
