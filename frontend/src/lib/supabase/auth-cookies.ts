type RawCookie = { name: string; value: string };

export function filterSupabaseCookies<T extends RawCookie>(
  cookies: T[],
  supabaseUrl: string,
): T[] {
  // Matches supabase-js's default storage key, including custom/local Supabase hosts.
  const projectKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  const keys = [projectKey, "sb-auth-token"];
  // SSR splits long sessions and also persists fixed/per-flow PKCE verifier keys.
  const suffix =
    /^(?:-(?:code-verifier|flows-code-verifier|flow-[A-Za-z0-9_-]{8,64}-code-verifier))?(?:\.(?:0|[1-9][0-9]*))?$/;
  return cookies.filter((cookie) =>
    keys.some(
      (key) =>
        cookie.name.startsWith(key) &&
        suffix.test(cookie.name.slice(key.length)),
    ),
  );
}
