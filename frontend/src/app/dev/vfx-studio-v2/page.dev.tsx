import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import Studio from "@/components/studio";
import {
  validateDocumentV2,
  type VfxDocumentV2,
} from "@/lib/vfx-lab/schema-v2";

export const metadata = {
  title: "VFX studio · v2 document review",
  robots: { index: false, follow: false },
};

const FIXTURE_ROOT = path.join(process.cwd(), "fixtures/v2");
const DEFAULT_FIXTURE = "fire-projectile";

/** Dev-only fixture picker — not a product preset list. */
function fixtureIds() {
  return readdirSync(FIXTURE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function loadFixture(id: string): VfxDocumentV2 {
  return validateDocumentV2(
    JSON.parse(
      readFileSync(path.join(FIXTURE_ROOT, id, "document.json"), "utf8"),
    ),
  );
}

export default async function VfxStudioV2Page({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string }>;
}) {
  const requested = (await searchParams).fixture;
  const id = requested ?? DEFAULT_FIXTURE;
  if (!fixtureIds().includes(id)) notFound();
  const document = loadFixture(id);
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
