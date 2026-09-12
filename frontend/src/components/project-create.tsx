"use client";
import { useState } from "react";
import { createProject } from "@/app/workspace/actions";

export default function ProjectCreate() {
  const [error, setError] = useState("");
  return <form className="project-create" action={async form => {
    setError("");
    const result = await createProject(form);
    if (result?.error) setError(result.error);
  }}>
    <label htmlFor="project-name" className="eyebrow">START SOMETHING NEW</label>
    <div><input id="project-name" name="name" placeholder="Name your exploration" required maxLength={120} /><CreateButton /></div>
    {error && <p className="error-text" role="alert">{error}</p>}
  </form>;
}

import { useFormStatus } from "react-dom";
function CreateButton() {
  const { pending } = useFormStatus();
  return <button className="account-primary" disabled={pending}>{pending ? "Creating…" : "Create project +"}</button>;
}
