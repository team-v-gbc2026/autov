# Studio generation and review regressions

This branch addresses #44–#49 following real authoring from blank projects.

- #44: constrain generated particle initial rotation and speed to runtime bounds.
- #45: preserve refinement failures, mark them terminal, and retain conservative provider reservations even if the failure-status write fails.
- #46: open stored capture references through an authenticated preview endpoint and a read-only dialog. Captures stay off the production mood board. The endpoint checks project ownership, exact storage path and capture provenance before signing.
- #47: reframe empty-to-generated transitions and authored camera changes into the visible area between panels. Ordinary edits preserve the user’s orbit. Honor authored camera framing; manual Focus uses a complete fit.
- #48: render the authored environment and retain it for local generation, matching the capture input instead of overriding it with the workspace defaults.
- #49: distinguish worker-not-connected, lost capture renewal and hard deadline; distinguish storage failure, missing candidate handle and conversation mismatch. Preserve ownership checks and direct recovery to the saved candidate, without automatic provider recharging. The original failed production operation’s initiating cause is not proven without its historical logs.

## Validation

Use Node 24 or later. The complete suite passed 608 tests (one pre-existing manual test skipped). Targeted preview, camera, candidate and capture diagnostics tests were repeated after final camera changes. Type checking, lint (zero errors), Eve build and Next production build passed. `verify-dev-excluded` confirms `/dev` routes are excluded from production.

Local visual review: [studio regression page](http://localhost:3021/dev/studio-regressions). Open the page with `next dev --port 3021`; it is intentionally unavailable in production. It starts empty. Load the generated scene, change the authored camera, change the background, and use Focus with the side panels and timeline visible. Chrome verification confirmed the empty-to-generated fit, camera orientation change, and authored purple background.

The fixture here is for regression testing, not a replacement for a user-authored effect. Production verification follows the main merge and its deployment; production generation/capture failures must be recorded separately from local deterministic test results.
