# AutoV AVFX Godot plugin (experimental)

This directory contains the distributable Godot plugin in `autov_avfx/`.
Copy it into an existing Godot project to use it. No Node.js or autoV server is
needed at runtime.

The first-pass `avfx/0.1` importer and player was tested with **Godot 4.6.1**
and the Compatibility renderer. Forward+/Mobile and other Godot versions have
not been verified.

## Install in your game

1. Copy this package's `autov_avfx` folder into your project's `addons`
   directory, so the plugin is at `res://addons/autov_avfx/plugin.cfg`.
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
remain compatible when installed at `res://addons/autov_avfx/`.

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
- Shipped Godot ports of all 17 source vertex/fragment programs,
  live camera/depth bindings, alpha/additive/premultiplied blending, draw order,
  continuous shader time and step-sampled CPU state. Seek and loop use one clock.

The AI still generates the **document**. AutoV's export button builds the
**bundle**. This adapter only consumes that bundle, not the source document.
Bundle GLSL is migration reference text and is **never compiled/executed**.
Its fingerprints must match the trusted source revision shipped by this adapter.

## Current limits

- Generator programs now include blob, crystal, splash, ribbon, wireBurst, arc,
  streak, sheet, crescent and lick, plus the auxiliary particle programs.
  Ten isolated generator fixtures pass rendered animation and exact-rewind checks
  on Godot 4.6.1 Compatibility. This is not full source-image parity coverage.
- Animated instance tables and mesh snapshots are read from the bundle; the
  adapter does not rebuild procedural generators. Remaining shader deformation
  runs live. Camera-frame layer transforms are still rejected during export.
- No per-particle camera-dependent alpha sorting: seed order is preserved.
  Transparent overlap can therefore differ from autoV.
- No automatic lights, environment, glow/bloom, grading or reference camera.
  Rendering is a smoke-tested port, not a pixel-parity certification.
- Linear textures and the shipped sampler conventions only: noise repeats,
  other image samplers clamp, lattice data uses nearest filtering. Arbitrary
  wrap/filter variants are not implemented. Screen blending is rejected.
  Front/back/double-sided draws and disabled depth testing are supported.
- Expanded geometry is limited to 60,000 instances / 1,000,000 vertices per draw.
  It uses a deliberately generous fixed bounding box; profile and tighten it
  before production use. This is not a GPU-instanced/high-scale implementation.
- CPU-evaluated state follows the bundle's step timeline (normally 60 Hz).
  Shader animation remains continuous. No history simulation or physics.
- Import validation is intended for autoV-produced bundles, not a complete
  hostile-file security boundary. Hashes detect accidental corruption, not
  authenticity. No engine executable, script or shader from a bundle is run.

Godot references: [GLSL conversion](https://docs.godotengine.org/en/stable/tutorials/shaders/converting_glsl_to_godot_shaders.html),
[spatial shaders](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html),
[depth reconstruction](https://docs.godotengine.org/en/stable/tutorials/shaders/advanced_postprocessing.html),
[custom resource import](https://docs.godotengine.org/en/stable/classes/class_editorimportplugin.html).
