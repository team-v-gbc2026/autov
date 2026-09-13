import Link from "next/link";

export const metadata = {
  title: "Dev utilities · AutoV",
  robots: { index: false, follow: false },
};

export default function DevPage() {
  return (
    <main style={{ maxWidth: 720, margin: "80px auto", padding: "0 24px", color: "#dce0df" }}>
      <p style={{ color: "#a58d65", fontSize: 11, letterSpacing: "0.12em" }}>LOCAL DEVELOPMENT</p>
      <h1 style={{ fontSize: 28, margin: "12px 0" }}>Dev utilities</h1>
      <p style={{ color: "#8e9a9f", marginBottom: 32 }}>Tools and isolated previews for working on AutoV.</p>
      <Link href="/dev/vfx-ui-review" style={{ display: "block", padding: 24, border: "1px solid #ffffff20", borderRadius: 12, background: "#ffffff05", textDecoration: "none", color: "inherit" }}>
        <strong>VFX UI review <span aria-hidden="true">↗</span></strong>
        <p style={{ color: "#8e9a9f", fontSize: 14, margin: "8px 0 0" }}>Preview the studio layout, emitter controls, and timeline with fixture data.</p>
      </Link>
      <Link href="/dev/chat" style={{ display: "block", marginTop: 16, padding: 24, border: "1px solid #ffffff20", borderRadius: 12, color: "inherit" }}>
        <strong>Agent chat preview ↗</strong>
        <p style={{ color: "#8e9a9f", fontSize: 14, margin: "8px 0 0" }}>Message formatting and simulated streaming with Send/Stop controls.</p>
      </Link>
    </main>
  );
}
