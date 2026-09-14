# Eve studio tools

The authored tools call shared operations in `src/lib/studio-tools`.
Document tools use persisted project revisions; browser tools use expiring operation
leases and Eve workflow waits. `defaultTools: false` keeps shell/filesystem/web tools
disabled. All adapters derive identity from the authenticated Eve session and verify
current project ownership before accessing service-role storage.

See `docs/EVE_STUDIO_TOOLS.md` at the repository root for setup, tool examples,
validation commands, cancellation/replay behavior, and extension boundaries.

`inspect_vfx_textures` reads only allowlisted public library assets, after project authorization, and returns pixels plus playback metadata. It does not access private assets or write board references.

`generate_vfx` applies the first pass without automatic review. `refine_vfx` requires explicit Continue approval from the authenticated user turn and checks the original operation and current revision before starting review/repair.
