import { productionBoardAssets } from "@/lib/studio-tools/board-assets";
import { notFound } from "next/navigation";
import Studio from "@/components/studio";
import { requireUser } from "@/lib/supabase/session";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, user } = await requireUser();
  const { data: project, error } = await supabase.from("projects").select("id,name,created_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this project.");
  if (!project) notFound();
  const [assets, operations] = await Promise.all([
    supabase.from("assets").select("id,name,storage_path,mime_type").eq("project_id", id).eq("archived", false).order("created_at"),
    supabase.from("studio_operations").select("input").eq("project_id", id).eq("kind", "generate"),
  ]);
  if (assets.error || operations.error) throw new Error("Could not load project history. Please retry.");
  const references = await Promise.all((await productionBoardAssets(assets.data || [])).map(async asset => {
    const { data, error } = await supabase.storage.from("references").createSignedUrl(asset.storage_path, 3600);
    if (error || !data) throw new Error("Could not load a reference image. Please retry.");
    return { id: asset.id, name: asset.name, type: asset.mime_type, url: data.signedUrl };
  }));
  // The board images an effect was built or refined from — durably recorded per
  // generate/refine operation's input, not reconstructed from chat text.
  const usedReferenceIds = [...new Set((operations.data || []).flatMap(operation => {
    const ids = (operation.input as { referenceIds?: unknown })?.referenceIds;
    return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === "string") : [];
  }))];
  return <Studio key={project.id} project={project} userId={user.id} email={user.email || ""} initialReferences={references} usedReferenceIds={usedReferenceIds} />;
}
