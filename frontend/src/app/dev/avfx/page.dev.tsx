import Link from "next/link";
import { loadFixtureDocument } from "@/lib/vfx-lab/fixtures-server";
import { validateDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import Workbench from "./workbench";

export const metadata = {
  title: "AVFX export workbench · AutoV",
  robots: { index: false, follow: false },
};

export default async function AvfxPage() {
  const source = await loadFixtureDocument("fire-projectile");
  if (source === null) {
    return <main style={{ padding: 40 }}>
      <Link href="/dev">← Dev utilities</Link>
      <h1>Fire-projectile fixture unavailable</h1>
      <p>Restore fixtures/v2/fire-projectile/document.json or connect to the fixture bucket, then reload.</p>
    </main>;
  }
  return <Workbench document={validateDocumentV2(source)} />;
}
