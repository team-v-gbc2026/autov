"use client";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="account-shell"><section className="account-card"><h1>We couldn’t load your workspace.</h1><p>Your work is still saved. Please try again.</p><button className="account-primary" onClick={reset}>Try again</button></section></main>;
}
