"use client";

import { useEffect, useState } from "react";

// Recharts only activates a tooltip on hover or touch-move, so a stationary tap on a touch screen
// shows nothing. On touch devices we switch the tooltip trigger to "click" so a single tap brings it
// up (and it stays until you tap elsewhere); pointer devices keep hover.
//
// Detection is deliberately broad: a media query for "can't hover / coarse pointer" catches phones
// and tablets up front, and a one-shot touchstart listener flips any device to touch the moment a
// real finger touch is seen, covering hardware the media query misreports.
export function useTooltipTrigger(): "hover" | "click" {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(hover: none), (pointer: coarse)");
    if (mq?.matches) setTouch(true);
    const onMq = () => { if (mq?.matches) setTouch(true); };
    const onTouch = () => setTouch(true);
    mq?.addEventListener?.("change", onMq);
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => {
      mq?.removeEventListener?.("change", onMq);
      window.removeEventListener("touchstart", onTouch);
    };
  }, []);
  return touch ? "click" : "hover";
}
