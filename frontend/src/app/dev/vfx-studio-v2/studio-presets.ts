// Curated fixture list for the studio picker dropdown — a deliberately short,
// hand-picked subset of FIXTURE_IDS meant for day-to-day studio review, not
// the exhaustive fixture catalog (see /dev/vfx-review and /dev/vfx-v2 for
// that). `?fixture=<id>` still accepts any id in FIXTURE_IDS for deep links;
// this list only controls what the dropdown shows.
export const STUDIO_PRESETS: { id: string; label: string }[] = [
  { id: "beam", label: "beam" },
  { id: "energy-column", label: "energy-column" },
  { id: "fire-projectile", label: "fire-projectile" },
  { id: "glitch-projectile", label: "glitch-projectile" },
  { id: "healing-aura", label: "healing-aura" },
  { id: "portal", label: "portal" },
  { id: "shield", label: "shield" },
  { id: "fire-slash-classic", label: "fire-slash" },
  { id: "ice-blast-classic", label: "ice-blast" },
];
