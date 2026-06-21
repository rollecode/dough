"use client";

import { useEffect } from "react";

// Recharts shows tooltips on hover and on touch-drag, but a stationary tap on a phone produces
// neither (it dispatches its tooltip only on touchmove), so tapping a chart shows nothing. Mounted
// once for the whole app, this listens for taps and, when one lands on a chart, dispatches a
// synthetic mousemove at that point so the chart's normal hover tooltip appears. Tapping away from
// any chart clears it. The synthetic mousemove bubbles to the recharts wrapper, whose onMouseMove
// reads clientX/clientY relative to itself - exactly what a real hover provides.
export function ChartTouchTooltips() {
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const wrapper = el?.closest(".recharts-wrapper");
      if (wrapper && el) {
        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, view: window }));
      } else {
        // Tapped off every chart: nudge each chart's pointer far outside so its tooltip dismisses.
        document.querySelectorAll<HTMLElement>(".recharts-wrapper").forEach((w) => {
          w.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: -9999, clientY: -9999, view: window }));
          w.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, clientX: -9999, clientY: -9999, view: window }));
        });
      }
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => document.removeEventListener("touchstart", onTouchStart);
  }, []);
  return null;
}
