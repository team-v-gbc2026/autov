import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";
import { filterSupabaseCookies } from "@/lib/supabase/auth-cookies";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (isSupabaseConfigured()) {
    const { url, key } = supabaseConfig();
    const supabase = createServerClient(url, key, { cookies: {
      getAll: () => filterSupabaseCookies(request.cookies.getAll(), url),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
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
    const rewritten = NextResponse.rewrite(url, { request: { headers: request.headers } });
    response.cookies.getAll().forEach(cookie => rewritten.cookies.set(cookie));
    rewritten.headers.set("Cache-Control", "private, no-store");
    return rewritten;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/workspace/:path*", "/login", "/auth/:path*", "/api/:path*"] };
