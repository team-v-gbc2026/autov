import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import styles from "./projects.module.css";

export default function WorkspaceHeader({ email }: { email: string }) {
  return <header className={styles.header}>
    <div className={styles.headerBrand}><Link href="/" className="wordmark" aria-label="Autov home"><span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span></Link><span className={styles.divider} /><span className={styles.breadcrumb}>Workspace</span></div>
    <div className={styles.account}><span className={styles.email}>{email}</span><span className="avatar" title={email}>{email.charAt(0).toUpperCase()}</span><form action={signOut}><button>Sign out</button></form></div>
  </header>;
}
