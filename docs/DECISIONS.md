# Decisions log

Append-only. One line per decision. Newest at the bottom. If a decision changes, add a new line — don't edit the old one.

| Date (JST) | Decision | Why | Who |
|---|---|---|---|
| 2026-09-11 | Track 2 (Game Development Tools) | Matches the team's game-dev background; judged on utility, not playability | Taiki |
| 2026-09-11 | Tools: GitHub (this repo + Projects) + Discord + Vercel only | Minimum surface area for a 4-day team of strangers | Taiki |
| 2026-09-11 | Production OpenAI key lives only in Vercel; members use their own keys locally | Single point of revocation, no key sharing | Taiki |
| 2026-09-11 | Repo visibility: TBD (public + free scanning vs. private) — team vote at kickoff | GitHub Free only gives branch protection / secret scanning on public repos | team |

| 2026-09-12 | Supabase Auth, private image Storage, and five RLS-protected application tables; effect definitions remain opaque JSON | Persist hackathon work while the generation team owns the VFX format; defer billing and teams | User + Codex |
