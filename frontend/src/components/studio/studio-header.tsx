"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import Tooltip from "@/components/ui/tooltip";
import ProjectName from "./project-name";
import ProfileMenu from "./profile-menu";
import type { Project } from "@/lib/project-types";

export default function StudioHeader({
  project,
  email,
  actions,
}: {
  project: Project;
  email: string;
  actions?: ReactNode;
}) {
  return (
    <header className="studio-header">
      <div className="project-heading">
        <Tooltip content="Back to projects" side="bottom">
          <Link href="/workspace" className="studio-back-brand" aria-label="Back to projects">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
            <span className="wordmark" aria-hidden="true"><span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span></span>
          </Link>
        </Tooltip>
        <span className="header-divider" />
        <ProjectName key={project.id} projectId={project.id} name={project.name} />
      </div>
      <div className="header-actions">
        {actions}
        <ProfileMenu email={email} />
      </div>
      
    </header>
  );
}
