import { headers } from "next/headers";
import VfxStudio from "@/components/vfx-lab/studio";
import { requireUser } from "@/lib/supabase/session";
import ProjectDirectory from "@/components/projects/project-directory";
import WorkspaceHeader from "@/components/projects/workspace-header";
import styles from "@/components/projects/projects.module.css";

export default async function WorkspacePage() {
  const host = (await headers()).get("host") || "";
  if (
    process.env.AUTOV_LOCAL_MODE === "1" &&
    !process.env.VERCEL &&
    /^(localhost|127\.0\.0\.1):\d+$/.test(host)
  )
    return <VfxStudio />;
  const { supabase, user } = await requireUser();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id,name,created_at")
    .order("created_at", { ascending: false });
  return (
    <main className={styles.shell}>
      <WorkspaceHeader email={user.email || ""} />
      <ProjectDirectory projects={projects || []} loadError={Boolean(error)} />
    </main>
  );
}
