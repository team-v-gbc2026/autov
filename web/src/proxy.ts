import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let configuredHost = "";
  try { if (appUrl) configuredHost = new URL(appUrl).hostname; } catch { /* Local route remains available without a domain. */ }
  if ((hostname.startsWith("app.") || hostname === configuredHost) && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/"] };
