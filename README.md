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
cp .env.example .env.local   # add YOUR OWN OpenAI key (never commit it)
npm install
npm run dev
```

## Environment variables
| Name | Where | Notes |
|---|---|---|
| `OPENAI_API_KEY` | `.env.local` (local) / Vercel env vars (prod) | Use your own key + your own hackathon credit locally. The production key lives only in Vercel. |

## Security — read this before your first push

This repo is **public**, so treat everything you commit as permanently readable by anyone.

- **Never commit API keys or tokens.** GitHub's push protection will reject the push anyway — if that happens, remove the secret and rotate the key rather than working around it.
- `main` is protected: no direct pushes, no force-push. Branch → PR → 1 approval → merge.
- Every PR is scanned by **gitleaks** and **CodeQL**. A high-severity CodeQL finding blocks the merge.
- Want an AI review? Comment **`@coderabbitai review`** on your PR. (CodeRabbit's free tier only reviews automatically once a repo has 10+ stars, so we ask for it by hand.)
- 2FA is required for every member of this org.

Full rules and the reasoning behind them: [`SECURITY.md`](SECURITY.md) — 2 minutes, please read once.

## How we work (short version)
- One task = one GitHub Issue. Board: **Projects → Team V! Board**.
- `main` is deploy-to-prod. Work on a branch, open a small PR, get one approval, merge.
- Pushing new commits dismisses earlier approvals — push everything before asking for review.
- Stuck for 15–30 min? Post in `#dev` on Discord.
- Decisions go in [`docs/DECISIONS.md`](docs/DECISIONS.md), not just chat.

## Team
| Name | Role | GitHub |
|---|---|---|
| Taiki Kawa | Lead / PM | [@TaikiKawa](https://github.com/TaikiKawa) |
| Eric Volkmann | Engineer | [@gd193](https://github.com/gd193) |
| Rahul Ghosh | Engineer | [@SYBIOTE](https://github.com/SYBIOTE) |

## Future work
TBD
