import { requireUser } from "@/lib/supabase/session";
import ProjectDirectory from "@/components/projects/project-directory";
import WorkspaceHeader from "@/components/projects/workspace-header";
import styles from "@/components/projects/projects.module.css";

export default async function WorkspacePage() {
  const { supabase, user } = await requireUser();
  const { data: projects, error } = await supabase.from("projects").select("id,name,created_at").order("created_at", { ascending: false });
  const withThumbnails = await Promise.all((projects || []).map(async project => {
    const { data } = await supabase.storage.from("project-thumbnails").createSignedUrl(`${project.id}/cover.webp`, 3600);
    return { ...project, thumbnail_url: data?.signedUrl };
  }));
  return <main className={styles.shell}>
    <WorkspaceHeader email={user.email || ""} />
    <ProjectDirectory projects={withThumbnails} loadError={Boolean(error)} />
  </main>;
}
