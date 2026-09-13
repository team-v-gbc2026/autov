"use client";

import { useState, type PointerEvent, type ReactNode } from "react";
import { autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, safePolygon, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from "@floating-ui/react";
import IconButton from "../studio/icon-button";
import styles from "./emitter-row.module.css";

export default function EmitterRow({ name, selected, editing, onEdit, onClose, onTag, controls, children }: {
  name: string;
  selected: boolean;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onTag: () => void;
  controls: ReactNode;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const open = hovered || editing;
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: value => { setHovered(value); if (!value) onClose(); },
    placement: "top",
    middleware: [offset(7), flip({ padding: 12 }), shift({ padding: 12, crossAxis: editing })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { enabled: !editing, delay: { open: 100, close: 120 }, handleClose: safePolygon() });
  const focus = useFocus(context, { enabled: !editing, visibleOnly: false });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const close = () => { setHovered(false); onClose(); };
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (editing || event.pointerType === "touch" || event.buttons !== 0) return;
    const row = event.currentTarget;
    const bounds = row.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    refs.setPositionReference({
      contextElement: row,
      getBoundingClientRect: () => {
        const current = row.getBoundingClientRect();
        return new DOMRect(current.left + x, current.top + y, 0, 0);
      },
    });
  };
  return <>
    <div ref={node => refs.setReference(node)} className={`lab-emitter-row ${selected ? "selected" : ""}`} {...getReferenceProps({
      onPointerEnter: followPointer,
      onPointerMove: followPointer,
      onFocus: event => {
        if (!editing && event.target.matches(":focus-visible")) refs.setPositionReference(event.currentTarget);
      },
    })}>
      {children}
    </div>
    {open && <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} disabled={!editing} initialFocus={0} returnFocus={editing}>
        <div ref={node => refs.setFloating(node)} style={floatingStyles} className={`${styles.panel} ${editing ? styles.editor : ""}`} {...getFloatingProps({ "aria-label": editing ? `Edit ${name}` : `${name} actions` })}>
          {editing ? <>
            <div className={styles.heading}><div><span className={styles.eyebrow}>EMITTER</span><h2 title={name}>{name}</h2></div><IconButton name="close" label="Close emitter controls" onClick={close} /></div>
            <div className={styles.controls}>{controls}</div>
          </> : <div className={styles.actions}>
            <IconButton name="edit" label={`Edit ${name}`} onClick={onEdit} />
            <IconButton name="tag" label={`Tag ${name} in chat`} onClick={() => { close(); onTag(); }} />
          </div>}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>}
  </>;
}
