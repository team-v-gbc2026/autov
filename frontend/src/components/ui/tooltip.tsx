"use client";

import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import styles from "./tooltip.module.css";

type TooltipProps = {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom" | "left" | "right";
};

/** Wrap a focusable control; give icon-only controls their own accessible label. */
export default function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;

  return (
    <span
      className={styles.root}
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={event => { if (event.key === "Escape") setDismissed(true); }}
    >
      <span className={styles.trigger}>{cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined,
      })}</span>
      {open && <span id={id} role="tooltip" className={`${styles.bubble} ${styles[side]}`}>{content}</span>}
    </span>
  );
}
