# Security & working agreement — Team V!

We're strangers building together for 4 days. These rules keep everyone (and everyone's accounts) safe. Please read once.

## 1. Secrets
- **Never commit API keys, tokens or passwords.** Keys live only in `.env.local` (git-ignored) and in Vercel environment variables.
- **Never paste a key into Discord, Issues or PRs.** If it happens: say so immediately, we revoke it, no blame.
- Every PR runs the checksum-pinned upstream `gitleaks` CLI in GitHub Actions, with redacted output. A failed check can indicate a secret finding or a scanner setup failure; inspect its logs. For an actual exposed secret, remove it **and** rotate the key.
- Use **your own** OpenAI key + your own $100 hackathon credit for local dev. The production key is set once in Vercel by the lead and is not shared.

## 2. Accounts & access
- Don't use your personal credentials on someone else's machine, and don't log in on shared/venue PCs.
- Members get **Write** access to this repo. Org admin, Vercel and the OpenAI project stay with the lead (single point of revocation).
- Enable 2FA on GitHub if you haven't (Settings → Password and authentication).

## 3. Code & IP
- **No third-party protected material** (characters, music, art, game assets, proprietary code) without permission — this is an explicit hackathon rule.
- Prefer permissive OSS (MIT/Apache/BSD). Note any dependency with an unusual license in `docs/DECISIONS.md`.
- Code in this repo is jointly owned by the team. Making the repo public, licensing, or reusing it after the event = team decision, in writing (an Issue is fine).

## 4. Git hygiene
- Branch from `main`, small PRs, one approval, squash-merge. No force-push to `main`.
- Don't commit large binaries (>10 MB) — link them instead.

## 5. After the event
- Lead revokes the production OpenAI key, clears Vercel env vars, and reviews org membership. Members can keep read access if the team agrees to go public.

Questions → ask in `#dev` or DM Taiki.
