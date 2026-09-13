import { readFileSync } from "node:fs";
import path from "node:path";
import Studio from "@/components/studio";
import { validateDocumentV2 } from "@/lib/vfx-lab/schema-v2";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function VfxUiReviewPage() {
  const document = validateDocumentV2(
    JSON.parse(
      readFileSync(
        path.join(process.cwd(), "fixtures/v2/fire-projectile/document.json"),
        "utf8",
      ),
    ),
  );
  return (
    <Studio
      project={{
        id: "00000000-0000-0000-0000-000000000000",
        name: "VFX Studio UI review",
        created_at: new Date(0).toISOString(),
      }}
      userId="00000000-0000-0000-0000-000000000000"
      email="preview@autov.app"
      initialReferences={[]}
      initialGenerations={[]}
      versions={[]}
      initialDocument={document}
    />
  );
}
