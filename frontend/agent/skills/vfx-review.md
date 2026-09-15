---
description: Evaluate a captured VFX candidate against the original request before committing or refining it.
---

Inspect the candidate reference pixels with inspect_references. Compare against
the original requirements, exclusions and reference evidence: silhouette, framing,
layer separation, color, texture suitability, start, main action and tail. Record
specific observable findings and successful details to preserve. Flat color,
sparse particles and abrupt stops can be intentional; do not apply generic visual
preferences against explicit intent. Do not infer frame-rate smoothness from a
contact sheet. Report insufficient evidence when captures cannot establish a claim.

For a localized mismatch, use edit_vfx_candidate and inspect the returned capture.
Each edit produces a separate candidate; retain the earlier candidate if it was
better. Commit only the selected captured candidate through commit_vfx_candidate,
supplying its exact operation/capture IDs, inspected reference ID, and a concise
review. Validation and GPU-budget errors require a supported document change.
