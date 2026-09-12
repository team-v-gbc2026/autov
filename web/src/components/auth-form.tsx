"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthForm() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <>
    <form className="account-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(""); setMessage("");
      const form = new FormData(event.currentTarget);
      const credentials = { email: String(form.get("email")).trim(), password: String(form.get("password")) };
      try {
        const supabase = createClient();
        const result = signup
          ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
          : await supabase.auth.signInWithPassword(credentials);
        if (result.error) throw result.error;
        if (result.data.session) { router.replace("/workspace"); router.refresh(); }
        else setMessage("Check your email to confirm your account, then sign in.");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in. Please try again."); }
      finally { setBusy(false); }
    }}>
      <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : 1} maxLength={128} required placeholder={signup ? "At least 8 characters" : "Your password"} /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      <button className="account-primary" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account ↗" : "Enter your studio ↗"}</button>
    </form>
    <button className="account-switch" disabled={busy} onClick={() => { setSignup(!signup); setMessage(""); setError(""); }}>{signup ? "Already have an account? Sign in" : "New here? Create an account"}</button>
  </>;
}
