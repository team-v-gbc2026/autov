"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/project-types";
import ProjectCard from "./project-card";
import ProjectDialog, { type ProjectDialogState } from "./project-dialog";
import styles from "./projects.module.css";

export default function ProjectDirectory({ projects, loadError }: { projects: Project[]; loadError: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [selection, setSelection] = useState<ProjectDialogState | null>(null);
  const [notice, setNotice] = useState("");
  const close = useCallback(() => setSelection(null), []);
  const saved = useCallback((warning?: string) => { setSelection(null); setNotice(warning || "Project updated."); router.refresh(); }, [router]);
  const filtered = useMemo(() => projects.filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.created_at.localeCompare(a.created_at)), [projects, query, sort]);
  return <section className={styles.content}>
    <div className={styles.intro}><div><h1>Projects</h1></div><button className={styles.primary} onClick={() => setSelection({ mode: "create" })}><span aria-hidden="true">+</span> New project</button></div>
    <div className={styles.toolbar}><div className={styles.collection}>All projects <span>{projects.length}</span></div><div className={styles.filters}><input type="search" aria-label="Search projects" placeholder="Search projects..." value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="name">Name A-Z</option></select></div></div>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loadError ? <div className={styles.empty} role="alert"><h2>Projects couldn&apos;t load.</h2><p>Try refreshing your workspace.</p><button className={styles.primary} onClick={() => router.refresh()}>Try again</button></div> : filtered.length ? <div className={styles.grid}>{filtered.map((project, index) => <ProjectCard key={project.id} project={project} index={index} onRename={() => setSelection({ mode: "rename", project })} onDelete={() => setSelection({ mode: "delete", project })} />)}{!query && <button className={styles.newCard} onClick={() => setSelection({ mode: "create" })}><span aria-hidden="true">+</span><strong>New project</strong></button>}</div> : <div className={styles.empty}><h2>{query ? "No matching projects" : "No projects yet"}</h2><p>{query ? "Try another project name." : "Create a project to get started."}</p><button className={styles.primary} onClick={() => query ? setQuery("") : setSelection({ mode: "create" })}>{query ? "Clear search" : "Create your first project"}</button></div>}
    
    {selection && <ProjectDialog selection={selection} onClose={close} onSaved={saved} />}
  </section>;
}
