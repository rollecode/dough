"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

const ACTION_WIDTH = 76; // px of edit action revealed on a full swipe
const OPEN_THRESHOLD = 40; // px past which a swipe snaps open instead of back

// A list row that navigates on tap and reveals an edit action when swiped left or right
// (iPhone-style). Editing is rare here, so it is tucked behind the swipe. On desktop, where there
// is no swipe, the edit button appears on hover instead.
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
  const startX = useRef(0);
  const startY = useRef(0);
  const base = useRef(0);
  const moved = useRef(false);
  const locked = useRef<"none" | "horizontal" | "vertical">("none");

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    base.current = offset;
    moved.current = false;
    locked.current = "none";
    setDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (locked.current === "none" && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      locked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (locked.current !== "horizontal") return; // let the page scroll vertically
    moved.current = true;
    setOffset(Math.max(-ACTION_WIDTH, Math.min(ACTION_WIDTH, base.current + dx)));
  };

  const onTouchEnd = () => {
    setDragging(false);
    if (offset > OPEN_THRESHOLD) setOffset(ACTION_WIDTH);
    else if (offset < -OPEN_THRESHOLD) setOffset(-ACTION_WIDTH);
    else setOffset(0);
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

  const active = dragging || offset !== 0;

  return (
    <div className={`swipe-row ${active ? "is-active" : ""}`} onDragOver={onDragOver}>
      <button type="button" className="swipe-row-edit is-left" onClick={handleEdit} aria-label={editLabel} tabIndex={-1}><Pencil /></button>
      <button type="button" className="swipe-row-edit is-right" onClick={handleEdit} aria-label={editLabel} tabIndex={-1}><Pencil /></button>
      <div
        className={`swipe-row-fg ${rowClassName} ${dragging ? "is-swiping" : ""}`}
        // Only drive the transform inline during an actual touch swipe; at rest leave it unset so
        // the desktop hover-peek (CSS) can slide the row aside without the inline value overriding it.
        style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
}
