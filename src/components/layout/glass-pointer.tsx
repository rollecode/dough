"use client";

import { useEffect } from "react";

// How much of the remaining distance the highlight covers each frame. Low on purpose: the light
// should flow towards the pointer over about a second, not snap to it like a spotlight.
const EASE = 0.055;

// Slow drift, so the glass is never completely still while the pointer rests on it.
const DRIFT_X = 3.2;
const DRIFT_Y = 2.4;
const DRIFT_PERIOD_X = 5200;
const DRIFT_PERIOD_Y = 7100;

// Frames to keep easing after the pointer leaves, so the light glides off instead of cutting out.
const SETTLE_FRAMES = 90;

/**
 * Cards are translucent, so their edge highlight has to answer the pointer to read as glass. One
 * delegated listener tracks it; a single animation loop eases the lit point towards the pointer and
 * adds a slow drift, writing --glass-x / --glass-y on the card for its rim gradient to follow.
 */
export function GlassPointer() {
  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;

    let card: HTMLElement | null = null;
    let targetX = 50;
    let targetY = 50;
    let x = 50;
    let y = 50;
    let frame = 0;
    let settle = 0;

    const clear = (el: HTMLElement) => {
      el.style.removeProperty("--glass-x");
      el.style.removeProperty("--glass-y");
      el.style.removeProperty("--glass-px");
      el.style.removeProperty("--glass-py");
    };

    const tick = (now: number) => {
      const el = card;

      if (!el) {
        frame = 0;
        return;
      }

      x += (targetX - x) * EASE;
      y += (targetY - y) * EASE;

      const driftX = Math.sin((now / DRIFT_PERIOD_X) * Math.PI * 2) * DRIFT_X;
      const driftY = Math.cos((now / DRIFT_PERIOD_Y) * Math.PI * 2) * DRIFT_Y;

      const px = x + driftX;
      const py = y + driftY;
      el.style.setProperty("--glass-x", `${px.toFixed(2)}%`);
      el.style.setProperty("--glass-y", `${py.toFixed(2)}%`);
      // -1..1 from the centre: the refraction layer leans this way, it does not follow the cursor.
      el.style.setProperty("--glass-px", (px / 50 - 1).toFixed(3));
      el.style.setProperty("--glass-py", (py / 50 - 1).toFixed(3));

      if (settle > 0) {
        settle--;
        if (settle === 0) {
          clear(el);
          card = null;
          frame = 0;
          return;
        }
      }

      frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const next = (e.target as Element | null)?.closest?.(".card") as HTMLElement | null;

      if (next !== card) {
        if (card) clear(card);
        card = next;
        settle = 0;

        if (card) {
          // Start the light where it last was relative to the new card, so it flows in.
          const r = card.getBoundingClientRect();
          x = ((e.clientX - r.left) / r.width) * 100;
          y = ((e.clientY - r.top) / r.height) * 100 > 50 ? 110 : -10;
        }
      }

      if (!card) return;

      const r = card.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width) * 100;
      targetY = ((e.clientY - r.top) / r.height) * 100;

      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onLeave = () => {
      if (card) settle = SETTLE_FRAMES;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave, { passive: true });

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      if (card) clear(card);
    };
  }, []);

  return null;
}
