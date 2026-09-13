import Link from "next/link";

export default function VfxV2DevIndexPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Toolbox v2 dev gallery</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Toolbox v2 dev gallery — excluded from production builds
      </p>
      <ul>
        <li>
          <Link href="/dev/vfx-v2/spike">Spike</Link>
        </li>
      </ul>
    </main>
  );
}
