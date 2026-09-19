"use client";

import { useEffect } from "react";

// Kept clear of the screen edge.
const MARGIN = 12;

/**
 * Info popups hang off their trigger, and whether that overflows depends on where the trigger
 * lands on screen, not which component it belongs to. Anchoring left or right per component only
 * moves the problem, so each popup is measured once it is visible and slid back inside the
 * viewport; its arrow slides the opposite way to stay on the trigger.
 */
export function InfoPopupPosition() {
  useEffect(() => {
    const place = (popup: HTMLElement) => {
      popup.style.setProperty("--info-shift", "0px");

      const r = popup.getBoundingClientRect();
      if (r.width === 0) return;

      let shift = 0;
      if (r.left < MARGIN) {
        shift = MARGIN - r.left;
      } else if (r.right > window.innerWidth - MARGIN) {
        shift = window.innerWidth - MARGIN - r.right;
      }

      popup.style.setProperty("--info-shift", `${Math.round(shift)}px`);
    };

    const placeAllVisible = () => {
      document.querySelectorAll<HTMLElement>(".metric-info-popup").forEach((popup) => {
        if (popup.offsetParent === null) return;
        place(popup);
      });
    };

    // The popup is display:none until its wrap opens, so measuring waits for the next frame.
    const placeSoon = (wrap: Element | null) => {
      if (!wrap) return;
      requestAnimationFrame(() => {
        const popup = wrap.querySelector<HTMLElement>(".metric-info-popup");
        if (popup && popup.offsetParent !== null) place(popup);
      });
    };

    const onPointerOver = (e: PointerEvent) => {
      placeSoon((e.target as Element | null)?.closest?.(".metric-info-wrap") ?? null);
    };

    const onClick = (e: MouseEvent) => {
      placeSoon((e.target as Element | null)?.closest?.(".metric-info-wrap") ?? null);
    };

    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("click", onClick);
    window.addEventListener("resize", placeAllVisible, { passive: true });

    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("click", onClick);
      window.removeEventListener("resize", placeAllVisible);
    };
  }, []);

  return null;
}
