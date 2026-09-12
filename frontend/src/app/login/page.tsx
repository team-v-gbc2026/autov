import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const configured = isSupabaseConfigured();
  if (configured) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) redirect("/workspace");
  }
  const { error } = await searchParams;
  return <main className="account-shell">
    <Link href="/" className="wordmark"><span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span></Link>
    <div className="account-grid"><section className="account-intro"><span className="eyebrow">YOUR NEXT EFFECT STARTS HERE</span><h1>A little spark.<br /><em>Entire worlds.</em></h1><p>A home for your references, experiments, and everything you haven’t imagined yet.</p><span className="account-index">01 — YOUR CREATIVE SPACE</span></section>
    <section className="account-card"><span className="eyebrow">WELCOME TO AUTOV</span><h2>Make room for an idea.</h2><p>Sign in to keep your work together.</p>
      {error && <p role="alert" className="error-text">The confirmation link could not be verified. Try signing in, or request a new confirmation email.</p>}
      {configured ? <AuthForm /> : <p role="alert" className="account-notice">Login is awaiting Supabase configuration. Set the project URL and publishable key in frontend/.env.local.</p>}
    </section></div>
  </main>;
}
