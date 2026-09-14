"use client";

import { useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from "react";
import { autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, safePolygon, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from "@floating-ui/react";
import IconButton from "../studio/icon-button";
import styles from "./emitter-row.module.css";

export default function EmitterRow({ name, selected, editing, onEdit, onClose, onTag, onDelete, controls, children }: {
  name: string;
  selected: boolean;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onTag: () => void;
  onDelete: () => void;
  controls: ReactNode;
  children: (barProps: ButtonHTMLAttributes<HTMLButtonElement> & { ref: (node: HTMLButtonElement | null) => void }) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const move = (x: number, y: number) => {
    const panel = refs.floating.current;
    if (!panel) return;
    setPosition({
      x: Math.max(12, Math.min(x, window.innerWidth - panel.offsetWidth - 12)),
      y: Math.max(12, Math.min(y, window.innerHeight - panel.offsetHeight - 12)),
    });
  };
  const open = hovered || editing;
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: value => { setHovered(value); if (!value) onClose(); },
    placement: "top",
    middleware: [offset(7), flip({ padding: 12 }), shift({ padding: 12, crossAxis: editing })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { enabled: !editing, delay: { open: 100, close: 120 }, handleClose: safePolygon() });
  const focus = useFocus(context, { enabled: !editing, visibleOnly: true });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const close = () => { setHovered(false); onClose(); };
  const followPointer = (event: PointerEvent<HTMLButtonElement>) => {
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
    <div className={`lab-emitter-row ${selected ? "selected" : ""}`}>
      {children({
        ...getReferenceProps({
          onPointerEnter: followPointer,
          onPointerMove: followPointer,
          onFocus: () => refs.setPositionReference(refs.domReference.current),
        }),
        ref: node => refs.setReference(node),
      })}
    </div>
    {open && <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} disabled={!editing} initialFocus={0} returnFocus={editing}>
        <div ref={node => refs.setFloating(node)} style={editing && position ? { position: "fixed", left: position.x, top: position.y } : floatingStyles} className={`${styles.panel} ${editing ? styles.editor : ""}`} {...getFloatingProps({ "aria-label": editing ? `Edit ${name}` : `${name} actions` })}>
          {editing ? <>
            <div className={styles.heading}>
              <button type="button" className={styles.dragHandle} aria-label={`Move ${name} settings`} title="Drag to move · Arrow keys to reposition"
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  const bounds = refs.floating.current?.getBoundingClientRect();
                  if (!bounds) return;
                  drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  if (drag.current) move(event.clientX - drag.current.x, event.clientY - drag.current.y);
                }}
                onPointerUp={event => {
                  drag.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => { drag.current = null; }}
                onLostPointerCapture={() => { drag.current = null; }}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                  event.preventDefault();
                  const bounds = refs.floating.current?.getBoundingClientRect();
                  if (!bounds) return;
                  const step = event.shiftKey ? 40 : 10;
                  move(bounds.left + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), bounds.top + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0));
                }}
              ><span>{name}</span></button>
              <IconButton name="close" label="Close emitter controls" onClick={close} />
            </div>
            <div className={styles.controls}>{controls}</div>
          </> : <div className={styles.actions}>
            <IconButton name="edit" label={`Edit ${name}`} onClick={onEdit} />
            <IconButton name="trash" label={`Delete ${name}`} onClick={() => { close(); onDelete(); }} />
            <IconButton name="tag" label={`Tag ${name} in chat`} onClick={() => { close(); onTag(); }} />
          </div>}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>}
  </>;
}
