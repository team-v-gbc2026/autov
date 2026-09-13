type RawCookie = { name: string; value: string };

// Matches supabase-js's default storage key, including custom/local Supabase hosts.
export function supabaseStorageKey(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

export function filterSupabaseCookies<T extends RawCookie>(
  cookies: T[],
  supabaseUrl: string,
): T[] {
  const keys = [supabaseStorageKey(supabaseUrl), "sb-auth-token"];
  // Preserve complete values, SSR chunks (long sessions), and the fixed/per-flow
  // PKCE verifier keys — nothing else, so unrelated cookies never get re-serialized.
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

export function hasLegacySession(cookies: RawCookie[], supabaseUrl: string): boolean {
  const key = supabaseStorageKey(supabaseUrl);
  let value = cookies.find(cookie => cookie.name === key)?.value ?? "";
  if (!value) {
    for (let index = 0; ; index++) {
      const chunk = cookies.find(cookie => cookie.name === `${key}.${index}`);
      if (!chunk) break;
      value += chunk.value;
    }
  }
  try {
    const json = value.startsWith("base64-")
      ? atob(value.slice(7).replace(/-/g, "+").replace(/_/g, "/"))
      : value;
    // A migration signal only, never an authorization check.
    return Object.prototype.hasOwnProperty.call(JSON.parse(json), "user");
  } catch {
    return false;
  }
}
