# Effect art direction and texture acquisition

The studio generation workflow now runs these stages in order:

1. **Art direction:** extract silhouette, layer roles, palette, timing, motion
   direction and uncertainty from the request and reference pixels, before a
   recipe is chosen.
2. **Texture acquisition:** shortlist existing library assets or generate masks
   needed by the effect. Up to two new masks may be generated per request,
   subject to the document's four embedded-texture limit and shared budget.
3. **Board registration:** save each generated PNG on the project's reference
   board with a stable identity and operation provenance. The runtime document
   embeds the same PNG bytes with a content hash.
4. **Texture direction:** inspect library/generated pixels and refine their
   layer bindings, UV treatment, tint and erosion. Unsuitable assets may be
   rejected in favor of procedural construction, with unmet needs recorded.
5. **Recipe planning and document generation:** use the established art direction
   and approved texture bindings.
6. **Render and apply:** capture the first pass and apply it immediately, without
   automatic review or repair. Chat offers a **Continue** chip.
7. **User-approved iteration:** only after Continue, review the displayed effect
   and run up to two repair rounds while preserving original art direction and
   existing textures. Keep the first pass visible until the result is ready.

`textureReferences` maps each generated asset's board `referenceId` and tag to
its runtime `textureId`, role and SHA-256. Board IDs are used to inspect or
mention an image. Runtime IDs are used in material masks. Existing board
polling discovers the new assets while generation runs; the final tool result
also returns their mappings and links.

The existing image generator creates isolated grayscale masks on transparent
backgrounds. They are single-frame, tintable luminance-times-alpha assets.
Generated color maps, seamless noise, and generated flipbooks are not included;
existing library flipbooks and procedural materials remain available. Image
generation is not a mandatory step for every effect.

Image calls use the same project operation ledger as text generation. Completed
calls replay saved assets; ambiguous calls are not automatically repeated.
Cache keys are scoped to project and owner. Board registration can be replayed
without creating duplicate cards. Physics is unchanged.

Verification covers stage ordering, exact pixel/reference propagation, generated
texture retention during repair/add mode, board registration identity and
provenance, and image-call replay. Tests mock provider and storage responses;
live image generation and a deployed board round trip were not run in this change.

Library textures actually used by masks, noise slots or particle trails are also
registered as board previews. Identical library previews reuse their board ID
within a project across operations. Layers keep using the library runtime ID;
procedural-only materials do not fabricate image assets. Existing effects gain
these previews on their next generation or approved iteration.

In production (`NODE_ENV=production`), board loading, polling and reference listing
hide timestamped capture evidence. Uploaded references and texture previews stay
visible. Reviewers can still resolve captures by ID. Development boards retain
diagnostic contact sheets. Filtering uses internal provenance, not editable names.
