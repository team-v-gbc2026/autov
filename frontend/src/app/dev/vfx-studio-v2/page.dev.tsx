import { notFound } from "next/navigation";
import Studio from "@/components/studio";
import FixturePicker from "./fixture-picker";
import { STUDIO_PRESETS } from "./studio-presets";
import { createDocument } from "@/lib/vfx-lab/ui-bridge";
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
  const ids = fixtureIds();
  // Reproduce the product's empty-workspace transition without an account or
  // project writes, and distinguish it from mounting a ready-made document.
  const empty = id === "empty";
  const newEmitter = id === "new-emitter";
  if (!empty && !newEmitter && !ids.includes(id)) notFound();
  const document = empty ? undefined : newEmitter
    ? createDocument("New workspace emitter")
    : await loadFixture(id);
  return (
    <Studio
      key={id}
      headerActions={<FixturePicker selectedId={id} presets={STUDIO_PRESETS} />}
      project={{
        id: "00000000-0000-0000-0000-000000000000",
        name: document?.name ?? "Empty workspace",
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
