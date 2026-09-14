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
  const [assets, generations, versions] = await Promise.all([
    supabase.from("assets").select("id,name,storage_path,mime_type").eq("project_id", id).eq("archived", false).order("created_at"),
    supabase.from("generations").select("id,prompt,status,created_at,error").eq("project_id", id).order("created_at"),
    supabase.from("effect_versions").select("id,schema_version,created_at").eq("project_id", id).order("created_at", { ascending: false }),
  ]);
  if (assets.error || generations.error || versions.error) throw new Error("Could not load project history. Please retry.");
  const references = await Promise.all((await productionBoardAssets(assets.data || [])).map(async asset => {
    const { data, error } = await supabase.storage.from("references").createSignedUrl(asset.storage_path, 3600);
    if (error || !data) throw new Error("Could not load a reference image. Please retry.");
    return { id: asset.id, name: asset.name, type: asset.mime_type, url: data.signedUrl };
  }));
  return <Studio key={project.id} project={project} userId={user.id} email={user.email || ""} initialReferences={references} initialGenerations={generations.data || []} versions={versions.data || []} />;
}
