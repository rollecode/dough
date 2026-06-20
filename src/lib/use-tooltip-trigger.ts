"use client";

import { useEffect, useState } from "react";

// Recharts only activates a tooltip on hover or touch-move, so a stationary tap on a touch screen
// shows nothing. On coarse-pointer (touch) devices we switch the tooltip trigger to "click" so a
// single tap brings it up (and it stays until you tap elsewhere); pointer devices keep hover.
export function useTooltipTrigger(): "hover" | "click" {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return coarse ? "click" : "hover";
}
