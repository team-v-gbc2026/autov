# Lighting-aware effect materials

V2 drawable layers support `material.shading: "unlit" | "litSmoke"`.
Older documents default to `unlit`. Generation and agent authoring receive this
option through the shared V2 technical guide and structured document schema.

Use `litSmoke` with alpha or premultiplied blending for smoke and dust. The
material's color ramp is modulated by ambient light and up to four active point
light layers, selected by intensity. Animate the light layer's existing color,
position, intensity, radius, and decay controls to change the illumination.
Existing masking, flipbooks, erosion, soft intersections, and opacity still apply.

Particle and sprite cards use an approximate hemisphere normal; mesh layers use
their surface normals. Ambient contributes a neutral fill at 0.3 times the
environment setting. Erosion edge emission remains emissive. Attached particle
trails remain unlit. This is approximate diffuse shading, without smoke
self-shadowing, volumetric scattering, or physics. It is not a Niagara material
export contract.

Validation:

```sh
cd frontend
PLAYWRIGHT_BROWSERS_PATH=/tmp/autov-playwright AUTOV_WEBGPU_SOFTWARE=1 \
  xvfb-run -a node scripts/webgpu/verify-smoke-lighting.mjs
```

The GPU regression checks left/right illumination, colored light response,
darkness without lighting, repeatable seeks, and unchanged unlit output for
particles and sprites. Images are written to `/tmp/autov-smoke-lighting`.
Software WebGPU establishes rendering behavior, not hardware performance.
