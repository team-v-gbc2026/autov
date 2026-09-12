type RawCookie = { name: string; value: string };

export function filterSupabaseCookies<T extends RawCookie>(cookies: T[], supabaseUrl: string): T[] {
  const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  const projectRef = refMatch?.[1];
  const pattern = projectRef ? `sb-${projectRef}-auth-token` : undefined;

  return cookies.filter((cookie) => {
    if (cookie.name === "sb-auth-token") return true;
    if (pattern && cookie.name === pattern) return true;
    if (/^sb-[a-z0-9-]+-auth-token$/i.test(cookie.name)) return true;
    return false;
  });
}
