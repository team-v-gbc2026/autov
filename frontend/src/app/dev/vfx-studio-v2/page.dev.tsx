import { notFound } from "next/navigation";
import Studio from "@/components/studio";
import {
  knownFixtureIds,
  loadFixtureDocument,
} from "@/lib/vfx-lab/fixtures-server";
import {
  validateDocumentV2,
  type VfxDocumentV2,
} from "@/lib/vfx-lab/schema-v2";

export const metadata = {
  title: "VFX studio · v2 document review",
  robots: { index: false, follow: false },
};

const DEFAULT_FIXTURE = "fire-projectile";

/** Dev-only fixture picker — not a product preset list. */
function fixtureIds() {
  return knownFixtureIds();
}

// Bucket first (vfx-fixtures/v2/<id>/document.json), local file as fallback.
async function loadFixture(id: string): Promise<VfxDocumentV2> {
  const document = await loadFixtureDocument(id);
  if (document === null) notFound();
  return validateDocumentV2(document);
}

export default async function VfxStudioV2Page({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string }>;
}) {
  const requested = (await searchParams).fixture;
  const id = requested ?? DEFAULT_FIXTURE;
  if (!fixtureIds().includes(id)) notFound();
  const document = await loadFixture(id);
  return (
    <Studio
      project={{
        id: "00000000-0000-0000-0000-000000000000",
        name: document.name,
        created_at: new Date(0).toISOString(),
      }}
      userId="00000000-0000-0000-0000-000000000000"
      email="preview@autov.app"
      initialReferences={[]}
      initialGenerations={[]}
      versions={[]}
      initialDocument={document}
      standalone
    />
  );
}
