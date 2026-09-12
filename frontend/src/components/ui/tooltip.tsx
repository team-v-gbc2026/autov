"use client";

import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { autoUpdate, flip, FloatingPortal, offset, safePolygon, shift, useDismiss, useFloating, useFocus, useHover, useInteractions } from "@floating-ui/react";
import styles from "./tooltip.module.css";

type TooltipProps = {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom" | "left" | "right";
};

/** Portal positioning keeps tooltips visible outside scrollable panels. */
export default function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen, placement: side,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, delay: { open: 200 }, handleClose: safePolygon() });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);
  return <>
    <span ref={node => refs.setReference(node)} className={styles.root} {...getReferenceProps()}>
      {cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined,
      })}
    </span>
    {open && <FloatingPortal><span ref={node => refs.setFloating(node)} id={id} role="tooltip" className={styles.bubble} style={floatingStyles} {...getFloatingProps()}>{content}</span></FloatingPortal>}
  </>;
}
