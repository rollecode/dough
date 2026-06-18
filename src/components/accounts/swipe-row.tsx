"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

const ACTION_WIDTH = 56; // px of the narrow edit action revealed on a full swipe
const OPEN_THRESHOLD = 28; // px past which a swipe snaps open instead of back

// A list row that navigates on tap and reveals a narrow edit action when swiped right-to-left
// (iPhone-style). Works with both touch and the mouse via pointer events. Editing is rare here, so
// it is tucked behind the swipe; clicking/tapping outside the row closes it again.
export function SwipeRow({
  href,
  onEdit,
  onDragOver,
  rowClassName = "",
  editLabel,
  children,
}: {
  href: string;
  onEdit: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  rowClassName?: string;
  editLabel: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const base = useRef(0);
  const moved = useRef(false);
  const axis = useRef<"none" | "x" | "y">("none");

  // When open, a pointer down anywhere outside the row closes it (undo the swipe).
  useEffect(() => {
    if (offset === 0) return;
    const onDocDown = (e: PointerEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) setOffset(0);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [offset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".acct-grip")) return; // leave the reorder grip alone
    startX.current = e.clientX;
    startY.current = e.clientY;
    base.current = offset;
    moved.current = false;
    axis.current = "none";
    draggingRef.current = true;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (axis.current === "none" && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "x") {
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    }
    if (axis.current !== "x") return; // vertical drag: let the page scroll
    moved.current = true;
    // Only the right-to-left direction reveals the edit action; clamp the rest closed.
    setOffset(Math.max(-ACTION_WIDTH, Math.min(0, base.current + dx)));
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    setOffset((o) => (o < -OPEN_THRESHOLD ? -ACTION_WIDTH : 0));
  };

  const handleClick = () => {
    if (moved.current) { moved.current = false; return; } // a swipe, not a tap
    if (offset !== 0) { setOffset(0); return; } // tap while open just closes it
    router.push(href);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOffset(0);
    onEdit();
  };

  // Show the pill only once the row has actually moved, so a plain click never flashes it.
  const active = offset !== 0;

  return (
    <div ref={rowRef} className={`swipe-row ${active ? "is-active" : ""}`} onDragOver={onDragOver}>
      <button type="button" className="swipe-row-edit is-right" onClick={handleEdit} aria-label={editLabel} tabIndex={-1}><Pencil /></button>
      <div
        className={`swipe-row-fg ${rowClassName} ${dragging ? "is-swiping" : ""}`}
        // Inline transform only while actively swiping; otherwise unset so it sits flush at rest.
        style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
}
