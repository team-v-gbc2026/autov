"use client";
import { useState } from "react";
export default function LocalSettings() {
  const [key, setKey] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="account-shell">
      <a href="/dev/vfx-lab" className="wordmark">
        autov.
      </a>
      <div className="account-card" style={{ margin: "10vh auto" }}>
        <h2>Connect OpenAI</h2>
        <p>
          Your key stays in this computer’s .env.local. This local tool stops
          new API calls when its configured cumulative budget is exhausted.
        </p>
        <form
          className="account-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const response = await fetch("/api/local-vfx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "setup", apiKey: key }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error);
              setKey("");
              setMessage("Connected. Your key was saved locally.");
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Setup failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            OpenAI API key
            <input
              aria-label="OpenAI API key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <button className="account-primary" disabled={busy || !key}>
            Save locally
          </button>
        </form>
        <p role="status">{message}</p>
        <a href="/dev/vfx-lab">Return to studio ↗</a>
      </div>
    </main>
  );
}
