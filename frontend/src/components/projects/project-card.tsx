import Link from "next/link";
import type { Project } from "@/lib/project-types";
import ProjectMenu from "./project-menu";
import styles from "./projects.module.css";

export default function ProjectCard({ project, index, onRename, onDelete }: {
  project: Project; index: number; onRename: () => void; onDelete: () => void;
}) {
  return <article className={styles.card}>
    <Link className={styles.cardLink} href={`/workspace/${project.id}`} aria-label={`Open ${project.name}`}>
      <div className={`${styles.art} ${styles[`variant${index % 3}`]}`} aria-hidden="true">
        {project.thumbnail_url ? <img className={styles.projectThumbnail} src={project.thumbnail_url} alt="" /> : <div className={styles.orbit}><i /><i /><i /></div>}
        
        
      </div>
      <div className={styles.cardBody}><h2 title={project.name}>{project.name}</h2><div><time dateTime={project.created_at}>{new Date(project.created_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time><span className={styles.openArrow} aria-hidden="true">↗</span></div></div>
    </Link>
    <ProjectMenu name={project.name} onRename={onRename} onDelete={onDelete} />
  </article>;
}
