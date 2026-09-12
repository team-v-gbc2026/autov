import Image from "next/image";
import type { Reference } from "@/lib/project-types";
import styles from "./composer.module.css";

export default function ReferencePicker({ items, active, onSelect }: { items: Reference[]; active: number; onSelect: (reference: Reference) => void }) {
  return <div className={styles.picker} aria-label="Choose a board reference">
    <span className={styles.pickerHeading}>Board references</span>
    {items.length ? items.map((reference, index) => <button type="button" key={reference.id} className={index === active ? styles.active : ""} onMouseDown={event => event.preventDefault()} onClick={() => onSelect(reference)}>
      <Image unoptimized src={reference.url} alt="" width={30} height={30} /><span>{reference.name}</span><small>@</small>
    </button>) : <p>No matching references.</p>}
  </div>;
}
