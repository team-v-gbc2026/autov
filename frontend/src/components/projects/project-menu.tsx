"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./projects.module.css";

export default function ProjectMenu({ name, onRename, onDelete }: {
  name: string; onRename: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className={styles.menu} ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className={styles.menuTrigger} aria-label={`Options for ${name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
    </button>
    {open && <div className={styles.menuItems}>
      <button onClick={() => { setOpen(false); onRename(); }}>Rename <span aria-hidden="true">↗</span></button>
      <button className={styles.destructive} onClick={() => { setOpen(false); onDelete(); }}>Delete <span aria-hidden="true">×</span></button>
    </div>}
  </div>;
}
