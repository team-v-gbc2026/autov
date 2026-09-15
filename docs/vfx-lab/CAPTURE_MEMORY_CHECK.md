# Final-stage capture memory check

The user reported a browser out-of-memory crash at the final generation stage.
The exact crash has not been reproduced on the user's device.

The studio only consumes a contact sheet, timestamps and a visible-pixel count.
Previously its capture also produced an unused twelve-frame motion strip and
30 Hz whole-effect diagnostics. A three-second effect submitted 113 renders;
studio contact-sheet capture now submits nine, including warm-up. Diagnostic
callers retain full motion evidence by default.

Capture now fixes pixel ratio at one (the requested dimensions are output
pixels), waits for each GPU submission, and awaits renderer disposal before
returning. Temporary canvas backing stores are released. The live studio's
render quality and effect settings are unchanged.

Verification used Chromium with software WebGPU at display DPR 2:

- A half-second fixture used 38 renders with full evidence and nine with the
  studio mode. Both returned identical contact-sheet JPEGs.
- Repeated contact sheets matched; no capture canvases remained in the DOM.
- Full evidence retained its strip and temporal measurements; studio mode
  omitted both. Capture renderer DPR was one throughout.
- The latest saved ten-layer, three-second candidate rendered a nonblank sheet
  with nine submissions and no browser console/page errors.
- Type checking, runtime bundling, and temporal/seek/operation tests passed.

Reproduction script: `frontend/scripts/webgpu/verify-capture-memory.mjs`.
Set `AUTOV_CAPTURE_DOCUMENT` to a saved candidate JSON to include it. Evidence
is written to `/tmp/autov-capture-memory`. No model calls are made.

This measures work removed, image equivalence and cleanup; it does not measure
peak GPU memory or establish a hardware memory ceiling. A full interactive
studio run on the affected device remains the confirmation of crash recovery.

Debug-profiler reference ledger: `debug-profile-checklists.md`,
`checklists/scene-debugging.md`, and `checklists/performance-profile.md` were
read. Applied checks: capture dimensions/DPR, renderer ownership, submitted
frames, asynchronous disposal, browser errors and nonblank output.
