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
