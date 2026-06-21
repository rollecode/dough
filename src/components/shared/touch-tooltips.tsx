"use client";

import { useEffect } from "react";

// Show the exact-amount tooltips (.amt-tip, rendered by <F/>) on touch. Those tooltips are pure CSS
// :hover, gated to @media (hover: hover), so on a touch screen they never appear. Touch events DO
// fire on any element on iOS - unlike mouse/click events, which iOS only dispatches for "clickable"
// elements - so a single delegated touchstart toggles an `is-open` class (the same mechanism the
// info-button popups already use successfully). Tap an amount to reveal its exact value; tap again,
// tap another amount, or tap elsewhere to dismiss. Desktop keeps its hover behavior untouched.
export function TouchTooltips() {
  useEffect(() => {
    const onTouch = (e: TouchEvent) => {
      const target = e.target as Element | null;
      const tip = target?.closest?.(".amt-tip") ?? null;
      // Close any other open amount tooltip.
      document.querySelectorAll(".amt-tip.is-open").forEach((el) => {
        if (el !== tip) el.classList.remove("is-open");
      });
      // Toggle the tapped one (tapping outside any amount just closes them all, handled above).
      if (tip) tip.classList.toggle("is-open");
    };
    document.addEventListener("touchstart", onTouch, { passive: true });
    return () => document.removeEventListener("touchstart", onTouch);
  }, []);
  return null;
}
