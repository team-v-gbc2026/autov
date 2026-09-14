# Eve studio tools

The authored tools call shared operations in `src/lib/studio-tools`.
Document tools use persisted project revisions; browser tools use expiring operation
leases and Eve workflow waits. `defaultTools: false` keeps shell/filesystem/web tools
disabled. All adapters derive identity from the authenticated Eve session and verify
current project ownership before accessing service-role storage.

See `docs/EVE_STUDIO_TOOLS.md` at the repository root for setup, tool examples,
validation commands, cancellation/replay behavior, and extension boundaries.
