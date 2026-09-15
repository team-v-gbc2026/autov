import { notFound } from "next/navigation";
import Studio from "@/components/studio";
import { loadFixtureDocument } from "@/lib/vfx-lab/fixtures-server";
import { validateDocumentV2 } from "@/lib/vfx-lab/schema-v2";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function VfxUiReviewPage() {
  // Bucket first (vfx-fixtures/v2/fire-projectile/document.json), local
  // fixtures/v2 copy as the offline fallback.
  const loaded = await loadFixtureDocument("fire-projectile");
  if (loaded === null) notFound();
  const document = validateDocumentV2(loaded);
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
      usedReferenceIds={[]}
      initialDocument={document}
      standalone
    />
  );
}
