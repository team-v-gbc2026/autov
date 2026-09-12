import Link from "next/link";
import { requireUser } from "@/lib/supabase/session";
import { signOut } from "@/app/auth/actions";
import ProjectCreate from "@/components/project-create";

export default async function WorkspacePage() {
  const { supabase, user } = await requireUser();
  const { data: projects, error } = await supabase.from("projects").select("id,name,created_at").order("created_at", { ascending: false });
  return <main className="projects-shell">
    <header className="projects-header"><Link href="/" className="wordmark"><span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span></Link><div><span>{user.email}</span><form action={signOut}><button className="account-switch">Sign out</button></form></div></header>
    <section className="projects-intro"><span className="eyebrow">THE WORKBENCH</span><h1>Your ideas,<br /><em>in good company.</em></h1><p>Collect a reference. Find a direction. Make it your own.</p></section>
    {error ? <p className="account-notice" role="alert">Your projects couldn’t load. Check the connection and that the database migration has been applied, then refresh.</p> : <>
      <ProjectCreate />
      <section className="project-grid" aria-label="Your projects">{projects?.map((project, index) => <Link key={project.id} href={`/workspace/${project.id}`} className="project-card"><div className="project-card-art"><span>✳</span><small>{String(index + 1).padStart(2, "0")}</small></div><div><h2>{project.name}</h2><span>Open studio ↗</span></div><time dateTime={project.created_at}>{new Date(project.created_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></Link>)}</section>
      {!projects?.length && <p className="projects-empty">A blank canvas, in the best way. Create your first project above.</p>}
    </>}
  </main>;
}
