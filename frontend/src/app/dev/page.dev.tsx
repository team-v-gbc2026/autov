import Link from "next/link";

export const metadata = {
  title: "Dev utilities · AutoV",
  robots: { index: false, follow: false },
};

const cardStyle = {
  display: "block",
  padding: 24,
  border: "1px solid #ffffff20",
  borderRadius: 12,
  background: "#ffffff05",
  textDecoration: "none",
  color: "inherit",
} as const;

const cards = [
  {
    href: "/dev/avfx",
    title: "AVFX export workbench",
    body: "Fire-projectile preview and first-pass particle / geometry export scope.",
  },
  {
    href: "/dev/chat",
    title: "Agent chat preview",
    body: "Message formatting and simulated streaming with Send/Stop controls.",
  },
  {
    href: "/dev/vfx-ui-review",
    title: "VFX UI review",
    body: "Preview the studio layout, emitter controls, and timeline with fixture data.",
  },
  {
    href: "/dev/vfx-studio-v2",
    title: "VFX studio on v2",
    body: "Product studio on a real v2 exemplar — ?fixture=<id>.",
  },
  {
    href: "/dev/vfx-v2",
    title: "Toolbox v2 gallery",
    body: "Side-by-side v1/v2 viewports for every fixtures/v2 exemplar and locally generated benchmark run.",
  },
  {
    href: "/dev/vfx-v2/spike",
    title: "Toolbox v2 spike",
    body: "Standalone renderer spike served from dev-assets/vfx-v2/spike.html.",
  },
  {
    href: "/dev/vfx-v2/spike-heal",
    title: "Toolbox v2 spike — healing aura",
    body: "Standalone healing-aura spike served from dev-assets/vfx-v2/spike-heal.html.",
  },
  {
    href: "/dev/vfx-v2/spike-smoke",
    title: "Toolbox v2 spike — smoke burst",
    body: "Blob-mesh anime smoke spike served from dev-assets/vfx-v2/spike-smoke.html.",
  },
  {
    href: "/dev/vfx-v2/spike-glitch",
    title: "Toolbox v2 spike — digital-glitch projectile",
    body: "Curved glitch projectile spike served from dev-assets/vfx-v2/spike-glitch.html.",
  },
  {
    href: "/dev/vfx-v2/spike-ice",
    title: "Toolbox v2 spike — ice area attack",
    body: "Blue-white ice area attack spike served from dev-assets/vfx-v2/spike-ice.html.",
  },
  {
    href: "/dev/vfx-v2/spike-shield",
    title: "Toolbox v2 spike — hex energy shield",
    body: "Teal hex shield with a gold band spike served from dev-assets/vfx-v2/spike-shield.html.",
  },
  {
    href: "/dev/vfx-v2/spike-beam",
    title: "Toolbox v2 spike — sustained energy beam",
    body: "Purple/white horizontal energy beam spike served from dev-assets/vfx-v2/spike-beam.html.",
  },
  {
    href: "/dev/vfx-v2/spike-portal",
    title: "Toolbox v2 spike — amber rectangular portal",
    body: "Yellow-rimmed amber portal spike served from dev-assets/vfx-v2/spike-portal.html.",
  },
  {
    href: "/dev/vfx-v2/spike-vortex",
    title: "Toolbox v2 spike — orange sky vortex",
    body: "Suspended orange spiral vortex spike served from dev-assets/vfx-v2/spike-vortex.html.",
  },
  {
    href: "/dev/vfx-v2/spike-column",
    title: "Toolbox v2 spike — golden energy column",
    body: "Golden energy-overload column spike served from dev-assets/vfx-v2/spike-column.html.",
  },
  {
    href: "/dev/vfx-v2/spike-meteor",
    title: "Toolbox v2 spike — meteor rain",
    body: "Five violet-tipped meteors with chunky cel-shaded smoke trails, served from dev-assets/vfx-v2/spike-meteor.html.",
  },
  {
    href: "/dev/vfx-v2/spike-water",
    title: "Toolbox v2 spike — water projectile",
    body: "Pale-cyan water head with dark-blue membrane sheets and toon droplets, served from dev-assets/vfx-v2/spike-water.html.",
  },
  {
    href: "/dev/vfx-v2/spike-playful",
    title: "Toolbox v2 spike — playful pink impact",
    body: "Cute cartoon pink burst: white star lines, procedural face symbols and heart sprites, served from dev-assets/vfx-v2/spike-playful.html.",
  },
  {
    href: "/dev/vfx-v2/spike-slash",
    title: "Toolbox v2 spike — fire slash",
    body: "Flaming crescent slash with a three-tone stack and a tearing tail, served from dev-assets/vfx-v2/spike-slash.html.",
  },
  {
    href: "/dev/vfx-review",
    title: "VFX review",
    body: "Every v2 exemplar family next to its benchmark reference video, with a jump to its spike page.",
  },
  {
    href: "/dev/vfx-lab",
    title: "Legacy local studio",
    body: "The original local VFX Lab studio: generate, refine and export effects with a local OpenAI key.",
  },
  {
    href: "/dev/vfx-lab/trials",
    title: "Local trials gallery",
    body: "Every locally generated candidate with its prompt, references, document, sheet and review.",
  },
];

export default function DevPage() {
  return (
    <main style={{ maxWidth: 720, margin: "80px auto", padding: "0 24px", color: "#dce0df" }}>
      <p style={{ color: "#a58d65", fontSize: 11, letterSpacing: "0.12em" }}>LOCAL DEVELOPMENT</p>
      <h1 style={{ fontSize: 28, margin: "12px 0" }}>Dev utilities</h1>
      <p style={{ color: "#8e9a9f", marginBottom: 32 }}>Tools and isolated previews for working on AutoV.</p>
      <div style={{ display: "grid", gap: 16 }}>
        {cards.map((card) => (
          <Link key={card.href} href={card.href} style={cardStyle}>
            <strong>
              {card.title} <span aria-hidden="true">↗</span>
            </strong>
            <p style={{ color: "#8e9a9f", fontSize: 14, margin: "8px 0 0" }}>{card.body}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
