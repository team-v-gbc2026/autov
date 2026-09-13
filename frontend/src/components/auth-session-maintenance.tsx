"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";
import { hasLegacySession } from "@/lib/supabase/auth-cookies";

let migration: Promise<void> | undefined;

export default function AuthSessionMaintenance() {
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const cookies = document.cookie.split(";").map(part => {
      const separator = part.indexOf("=");
      return { name: part.slice(0, separator).trim(), value: part.slice(separator + 1) };
    });
    const legacy = hasLegacySession(cookies, supabaseConfig().url);
    const supabase = createClient();
    if (!legacy || migration) return;
    // SDK refresh persists tokens-only and expires obsolete cookie chunks.
    // Share the operation across React Strict Mode mounts.
    migration = (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) await supabase.auth.refreshSession();
      } catch {
        // A later mount can retry after a network or browser-storage failure.
      } finally {
        migration = undefined;
      }
    })();
  }, []);
  return null;
}
