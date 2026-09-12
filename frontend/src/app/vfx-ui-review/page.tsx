import Studio from "@/components/studio";
import { notFound } from "next/navigation";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function VfxUiReviewPage() {
  // This fixture is review-only even if it is accidentally left in a merge.
  if (process.env.VERCEL_ENV === "production") notFound();

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
