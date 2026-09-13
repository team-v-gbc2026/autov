import Studio from "@/components/studio";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function VfxUiReviewPage() {
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
    />
  );
}
