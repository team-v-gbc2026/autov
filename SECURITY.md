# Security & working agreement — Team V!

We're four days, three people and one public repo. These rules keep everyone's
accounts and keys safe. Please read once — it takes two minutes.

## 0. What's enforced automatically

You don't have to remember all of this. GitHub enforces most of it for you:

| Guard | What it does |
|---|---|
| Push protection | Rejects any push that contains an API key or token, before it reaches GitHub |
| Secret scanning | Alerts us if a credential ever lands in the repo; major providers auto-revoke leaked keys |
| gitleaks (CI) | Scans every PR for secrets GitHub's own patterns miss — homemade tokens, high-entropy strings |
| CodeQL | Scans every PR for vulnerabilities — high severity blocks the merge |
| Branch ruleset on `main` | No direct pushes, no force-push, no branch deletion |
| Dependabot | Alerts and fix PRs for vulnerable dependencies |
| 2FA | Required for every org member |
| Interaction limits | Only repo collaborators can open PRs, issues or comments |

CodeRabbit is the one thing that is **not** automatic: its free tier only
auto-reviews repos with 10+ stars, so you have to ask for a review. See section 5.

## 1. Secrets

- **Never commit API keys, tokens or passwords.** Keys live only in `.env.local` (git-ignored) and in Vercel environment variables.
- **Never paste a key into Discord, an Issue or a PR.** If it happens, say so immediately — we rotate it, no blame. Speed matters far more than fault.
- If a push is rejected for containing a secret, **don't bypass it.** Remove the secret from the commit, rotate the key, push again.
- Use **your own** OpenAI key and your own hackathon credit for local development. The production key is set once in Vercel by the lead and is never shared.

## 2. Accounts & access

- Don't sign in with your credentials on someone else's machine, and never on a shared or venue PC.
- Members have **Write** access to this repo. Org administration, Vercel billing and the OpenAI project stay with the lead — one place to revoke everything if something goes wrong.
- 2FA is required by the organization. If you turn it off, GitHub removes you from the org automatically.

## 3. This repo is public

- Assume **anything you commit is readable by anyone, forever** — including deleted files, which stay in the git history.
- Public is a deliberate choice: it is what makes the security tooling above free, and the hackathon rules don't require a private repo.
- Before pasting anything into a commit, an Issue or a PR, ask: would I be fine with a stranger reading this? Config samples yes, real values no.

## 4. Code & IP

- **No third-party protected material** — characters, music, art, game assets or proprietary code — without permission. This is an explicit hackathon rule.
- Prefer permissive open source (MIT / Apache / BSD). Note any dependency with an unusual license in [`docs/DECISIONS.md`](docs/DECISIONS.md).
- Code here is jointly owned by the team. Licensing or reusing it after the event is a team decision, in writing — an Issue is fine.

## 5. Git hygiene

- Branch from `main`, keep the PR small, get one approval, merge.
- New commits dismiss earlier approvals, so push everything before asking for review.
- **Ask CodeRabbit for a review:** comment `@coderabbitai review` on your PR, then read what it says. It is allowed to be wrong — say why and move on — but don't merge a non-trivial PR without looking.
- Don't commit binaries over 10 MB. Link to them instead.

## 6. After the event

The lead revokes the production OpenAI key, clears the Vercel environment variables, and reviews org membership.

## Reporting something

Found a vulnerability, or think a key leaked? Post in `#dev` on Discord or DM Taiki directly. Don't open a public Issue for it.
