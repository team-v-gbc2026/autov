"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { useFormStatus } from "react-dom";
import Tooltip from "@/components/ui/tooltip";
import styles from "./profile-menu.module.css";

function SignOutButton() {
  const { pending } = useFormStatus();
  return <button className={styles.signOut} type="submit" disabled={pending}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5v14h4M10 12h11m-4-4 4 4-4 4" /></svg>
    {pending ? "Signing out..." : "Sign out"}
  </button>;
}

export default function ProfileMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <div className={styles.root} ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Tooltip content="Your account" side="left">
      <button ref={trigger} className={styles.trigger} aria-label="Your account" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden="true">{email.charAt(0).toUpperCase() || "A"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
    </Tooltip>
    {open && <div className={styles.dropdown}>
      <div className={styles.identity}><span>Signed in as</span><strong>{email}</strong></div>
      <form action={signOut}><SignOutButton /></form>
    </div>}
  </div>;
}
