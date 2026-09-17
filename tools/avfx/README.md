# AVFX developer checks

These files are developer tooling, not part of the distributed Godot addon.
Run TypeScript commands from `frontend/` with the project's dependencies.

```sh
node --import tsx --test tests/avfx.test.ts tests/avfx-mesh-snapshots.test.ts
npm run typecheck
```

For engine checks, create an isolated directory containing `project.godot` and
the `check_*.gd` scripts from `godot-tests/`. Copy `godot-plugin/autov_avfx` to its
`addons/autov_avfx` directory. Generate fixtures into that project's `fixtures/`:

```sh
node --import tsx ../tools/avfx/generate-mesh-fixtures.mts /absolute/test-project/fixtures
node --import tsx ../tools/avfx/generate-animation-fixture.mts /absolute/test-project/fixtures/animation.avfx
node --import tsx ../tools/avfx/generate-generator-fixtures.mts /absolute/test-project/generators
godot --headless --path /absolute/test-project --script check_meshes.gd
godot --path /absolute/test-project --script check_shaders.gd
godot --path /absolute/test-project --script check_animation.gd
godot --path /absolute/test-project --script check_generators.gd
```

The rendering checks need a display (Linux CI can use `xvfb-run -a`). Set
`XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_CONFIG_HOME` to isolated temporary
directories to avoid touching normal editor settings. Animation captures are
saved to the test project's Godot `user://` directory.

`check_meshes.gd` validates GLB topology, winding and attribute packing.
`check_shaders.gd` checks shader loading/reflection, not visual parity.
`check_animation.gd` checks actual bundle loading, changing rendered mesh samples,
pixel-exact rewind and end visibility. It is a regression test, not a comparison
against source-renderer images. `check_generators.gd` separately exercises ten
generator kinds with visible animation and exact rewind; it does not certify
source-image parity or all material variants.

Regenerate trusted Godot shader definitions with:

```sh
node --import tsx ../tools/avfx/generate-godot.mts
```

Particle and surface ports are preserved. Broader ports have isolated generator
render coverage; auxiliary particle programs currently have compile coverage.
