import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

export function createClient() {
  const { url, key } = supabaseConfig();
  return createBrowserClient(url, key, { cookies: { encode: "tokens-only" } });
}
