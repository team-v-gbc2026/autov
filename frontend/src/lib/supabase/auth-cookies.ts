type RawCookie = { name: string; value: string };

export function supabaseStorageKey(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

export function filterSupabaseCookies<T extends RawCookie>(cookies: T[], supabaseUrl: string): T[] {
  const key = supabaseStorageKey(supabaseUrl);
  // Preserve complete values, obsolete chunks for SDK cleanup, and PKCE flows.
  return cookies.filter(({ name }) =>
    name === key || name.startsWith(`${key}.`) || name.startsWith(`${key}-`),
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
