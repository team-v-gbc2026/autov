# autoV — Team V! · TAI × OpenAI 100-Hour Game Builder Challenge 2026

> **Track 2: Game Development Tools** — an AI-powered tool that changes how games are developed, tested, localized, operated or distributed.

**Status:** building · **Deadline:** Tue Sep 15, 23:59 JST · **Showcase:** Thu Sep 17, 18:00 @ Sakura Deeptech Shibuya

## One-liner
<!-- Fill at kickoff: "(who)'s (which step of game dev) can now (what), because OpenAI's (which capability) lets us (how)." -->
TBD

## Problem
TBD

## Solution
TBD

## Demo
- Live: <Vercel URL>
- Video: <link>

## How we use OpenAI
<!-- Judges weight this at 30%. Be specific: which API / model / feature, and what it enables that wasn't possible before. -->
TBD

## Architecture
```
[UI] → [API route] → [OpenAI API] → [result]
```

## Tech stack
- Next.js (App Router) on Vercel
- OpenAI API (`openai` SDK)

## Setup
```bash
git clone https://github.com/team-v-gbc2026/autov.git
cd autov
cp frontend/.env.example frontend/.env.local
npm --prefix frontend ci
npm --prefix frontend run dev
```

## Vercel deploy

Set the Vercel project's **Root Directory** to `frontend`. Vercel will then detect the Next.js app and its lockfile correctly. The app-level `frontend/vercel.json` uses:
- Install: `npm ci`
- Build: `npm run build`

## Environment variables
| Name | Where | Notes |
|---|---|---|
| `OPENAI_API_KEY` | `.env.local` (local) / Vercel env vars (prod) | Use your own key + your $100 hackathon credit locally. Production key lives only in Vercel. |

## How we work (short version)
- One task = one GitHub Issue. Board: **Projects → Team V! Board**.
- `main` is deploy-to-prod. Work on a branch, open a small PR, get one 👍, merge.
- Stuck for 15–30 min? Post in `#dev` on Discord.
- Decisions go in [`docs/DECISIONS.md`](docs/DECISIONS.md), not just chat.
- Security rules: [`SECURITY.md`](SECURITY.md) — please read once (2 min).

## Team
| Name | Role | GitHub |
|---|---|---|
| Taiki Kawa | Lead / PM | @TaikiKawa |
| | | |

## Future work
TBD

## App, login, and database

The Next.js app lives in `frontend/`. See [app/database setup and generation integration](docs/APP_DATABASE.md) for environment variables, authentication, migrations, and the generation-team contract.
