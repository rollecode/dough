"use client";

import { useEffect } from "react";

// Recharts shows tooltips on hover and (in v3) on touch-drag, but never on a stationary tap, and its
// trigger="click" does not fire on a pure touch tap either (verified: a tap with no compatibility
// mouse events, as on iOS Safari, shows nothing). Mounted once for the whole app, this listens for
// touches and, when one is over a chart, dispatches a synthetic mousemove at that point so the
// chart's normal hover tooltip appears and follows the finger. The synthetic mousemove bubbles to
// the recharts wrapper, whose onMouseMove reads clientX/clientY relative to itself - exactly what a
// real hover provides. A touch off every chart nudges each chart's pointer outside to dismiss it.
export function ChartTouchTooltips() {
  useEffect(() => {
    const relay = (clientX: number, clientY: number): boolean => {
      const el = document.elementFromPoint(clientX, clientY);
      const wrapper = el?.closest(".recharts-wrapper");
      if (wrapper && el) {
        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX, clientY, view: window }));
        return true;
      }
      return false;
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (!relay(t.clientX, t.clientY)) {
        document.querySelectorAll<HTMLElement>(".recharts-wrapper").forEach((w) =>
          w.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: -9999, clientY: -9999, view: window }))
        );
      }
    };
    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("touchmove", onTouch);
    };
  }, []);
  return null;
}
