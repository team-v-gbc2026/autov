# AutoV → Godot adapter (experimental)

First-pass `avfx/0.1` importer and player, tested with **Godot 4.6.1,
Compatibility renderer** and the exported fire-projectile fixture (six particle
layers + two geometry layers). No Node.js or autoV server is needed at runtime.
Forward+/Mobile and other Godot versions have not been verified.

## Try the demo

1. In autoV, open `/dev/avfx`, select fire-projectile and click **Export .avfx**.
2. Open this folder's `project.godot` in Godot 4.6.1.
3. Run the project (F6 runs the open scene; F5 runs this demo).
4. Click **Open .avfx** and choose the downloaded file. Play, pause, restart or
   scrub the timeline. It loops by default.

Alternatively put the bundle at `examples/fire-projectile.avfx`, or run:

```sh
godot --path godot-plugin -- /absolute/path/to/fire-projectile.avfx
```

The demo deliberately does not recreate autoV's post-processing or lighting.
The fixture is a local export, not a committed asset; a fresh clone needs the
export/download step above.

## Install in your game

This is a regular Godot editor/runtime plugin: only `addons/autov_avfx` is
required. The demo project, Node tools and test scripts are optional.

1. Copy `addons/autov_avfx` into your project's `addons` directory.
2. Enable **AutoV AVFX** in **Project → Project Settings → Plugins**.
3. Copy your `.avfx` into the project's filesystem, e.g.
   `res://effects/fire-projectile.avfx`. Godot imports it as an AVFX resource.
4. Add an **AVFXEffect** node using **Add Node** (autoV icon). Drop the imported
   resource into the resource picker in its **AVFX EFFECT** Inspector panel.
   Leave **Autoplay in game** on, or control it from code. A live `Camera3D` is
   required for gameplay billboarding.
5. Place the node under your actor/socket and set its transform. Disable **Loop
   in game** for a one-shot. Use **Preview**, **Pause**, **Restart** and the
   timeline slider directly in the Inspector without running the game.

The panel also shows effect name, duration, layer count and load errors, with
playback speed and editor-viewport selection. Changes support scene undo/redo.
The script field is hidden by this Inspector; implementation remains ordinary
GDScript inside the addon, not a compiled native extension. Godot may still show
its script icon in the scene tree. Existing AVFXPlayer scenes and script API
remain compatible because `player.gd` has not moved.

### See it without running the game

Open `demo/main.tscn` and select its saved **AVFXPlayer** child. If the local
`examples/fire-projectile.avfx` exists and has imported, the demo assigns it as
a fallback. Otherwise copy a bundle into your Godot project and drag the imported
resource onto **Effect**. Loading an external file through the running demo
does not save that choice into the editor scene.

In any scene, a node with an effect assigned shows a still frame immediately:

- The **timeline slider** scrubs and pauses the effect (default: 1 second).
- **Preview** enables looping editor animation; **Pause** holds the current frame.
- **Restart** begins preview again from zero.
- Camera-facing uniforms track the editor camera even while paused. With split
  views, choose **Editor Viewport** (0–3); one camera's uniforms are shared by
  the player, so simultaneous split-view billboarding is not supported.

No scene Camera3D is needed for editor preview. Gameplay still needs one.
Generated meshes are transient and are not saved as duplicate scene children.
The camera is obtained through Godot's
[editor viewport API](https://docs.godotengine.org/en/4.6/classes/class_editorinterface.html#class-editorinterface-method-get-editor-viewport-3d).

The imported resource embeds the archive's assets, so normal Godot resource
dependencies carry them into game exports. Keep a resource reference (as below
or in a scene); do not rely on dynamic string paths being discovered by the
exporter. You do not need to ship the original raw `.avfx` when using an imported
resource.

```gdscript
const AVFXPlayerScript = preload("res://addons/autov_avfx/player.gd")
const FIRE = preload("res://effects/fire-projectile.avfx")

func spawn_fire(parent: Node3D) -> Node3D:
    var fx = AVFXPlayerScript.new()
    fx.effect = FIRE
    fx.loop = false
    parent.add_child(fx)
    fx.finished.connect(fx.queue_free)
    fx.play(true)
    return fx

# fx.pause()
# fx.seek(1.25)       # Absolute seconds; does not implicitly pause.
# fx.play()          # Resume; play(true) restarts.
# fx.stop()          # Pause and seek to zero.
```

For a downloaded/external archive, `fx.load_file(absolute_path)` returns `OK`
or a load error. Reconstruction runs deferred when changing Effect on a live
node; connect `load_failed(message)` for subsequent mesh/texture errors.
`last_error` retains the latest failure. Editor import validates the archive;
mesh/texture reconstruction is validated when the player builds the effect.

## What is implemented

- Bounded STORE-ZIP loading without extracting files; version, inventory,
  SHA-256, relative-path and timeline checks. Resource import stores assets in
  Godot's import cache.
- Geometry-only GLB reconstruction, column-major sampled transforms, animated
  mesh references, numeric uniforms and curve/ramp arrays, PNG textures, and
  float RGBA data textures.
- Original particle seeds/attributes, carried in a float data texture. Base
  particle meshes are expanded into one mesh per draw; Godot's particle
  simulator does not regenerate the effect.
- Shipped Godot ports of the `particle` and `surface` vertex/fragment programs,
  live camera/depth bindings, alpha/additive/premultiplied blending, draw order,
  continuous shader time and step-sampled CPU state. Seek and loop use one clock.

The AI still generates the **document**. AutoV's export button builds the
**bundle**. This adapter only consumes that bundle, not the source document.
Bundle GLSL is migration reference text and is **never compiled/executed**.
Its fingerprints must match the trusted source revision shipped by this adapter.

## Current limits

- Only `particle` and `surface` programs. This covers this fire projectile and
  some basic geometry/particle combinations, **not every geometry export**.
  Trail, strip, sub-particle and other programs fail explicitly. Generators
  remain outside this first pass.
- No per-particle camera-dependent alpha sorting: seed order is preserved.
  Transparent overlap can therefore differ from autoV.
- No automatic lights, environment, glow/bloom, grading or reference camera.
  Rendering is a smoke-tested port, not a pixel-parity certification.
- Linear textures and the shipped sampler conventions only: noise repeats,
  other image samplers clamp, lattice data uses nearest filtering. Arbitrary
  wrap/filter variants are not implemented. Screen blending and non-double-sided
  draws are rejected.
- Expanded geometry is limited to 60,000 instances / 1,000,000 vertices per draw.
  It uses a deliberately generous fixed bounding box; profile and tighten it
  before production use. This is not a GPU-instanced/high-scale implementation.
- CPU-evaluated state follows the bundle's step timeline (normally 60 Hz).
  Shader animation remains continuous. No history simulation or physics.
- Import validation is intended for autoV-produced bundles, not a complete
  hostile-file security boundary. Hashes detect accidental corruption, not
  authenticity. No engine executable, script or shader from a bundle is run.

## Development and checks

From the repository root (replace `godot` with your Godot 4.6.1 executable):

```sh
godot --headless --path godot-plugin --editor --import --quit
godot --headless --path godot-plugin --script tests/check_shaders.gd
godot --headless --path godot-plugin --editor tests/editor_preview.tscn -- --avfx-editor-test
godot --headless --path godot-plugin --script tests/check_bundle.gd -- /absolute/path/to/fire-projectile.avfx
godot --path godot-plugin --rendering-method gl_compatibility --script tests/render_smoke.gd -- /absolute/path/to/fire-projectile.avfx
```

The editor test requires that fixture imported at `examples/fire-projectile.avfx`
and checks still-frame scrubbing, animation, editor camera bindings and transient
draw ownership. The bundle test expects the eight-layer fire-projectile fixture. It checks
construction, repeatable backward seeks, end visibility, playback controls,
resource roundtrip and corrupt-texture rejection. The renderer test saves
`test-output/fire-projectile.png`; inspect it and check the console for GPU
shader errors. On Linux CI it can run under `xvfb-run -a` (Mesa software rendering
was used for the initial verification).

Regenerate the **trusted** shader ports after changing autoV's shader source:

```sh
cd frontend
node --import tsx ../godot-plugin/tools/generate-shaders.mjs
```

Commit the generated shaders and `shader_versions.gd` together. The generator
is a narrow port of this project's shader dialect, not a general GLSL converter.
Re-run both shader and actual-render checks after any source change.

Godot references: [GLSL conversion](https://docs.godotengine.org/en/stable/tutorials/shaders/converting_glsl_to_godot_shaders.html),
[spatial shaders](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html),
[depth reconstruction](https://docs.godotengine.org/en/stable/tutorials/shaders/advanced_postprocessing.html),
[custom resource import](https://docs.godotengine.org/en/stable/classes/class_editorimportplugin.html).
