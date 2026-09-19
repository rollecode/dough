"use client";

import { useEffect } from "react";

// Temporary: tells whether a sideways pan on a phone was layout overflow or a zoom, and which element stuck out.
export function OverflowReporter() {
  useEffect(() => {
    let sent = false;

    const report = (kind: "overflow" | "zoom") => {
      if (sent) {
        return;
      }
      sent = true;
      const de = document.documentElement;
      const cw = de.clientWidth;
      const over = [...document.querySelectorAll("body *")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.right > cw + 0.5)
        .sort((a, b) => b.r.right - a.r.right)
        .slice(0, 6)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      navigator.sendBeacon("/api/debug/overflow", JSON.stringify({
        kind,
        path: location.pathname,
        innerWidth: window.innerWidth,
        clientWidth: cw,
        scrollWidth: de.scrollWidth,
        scale: window.visualViewport?.scale,
        over,
      }));
    };

    const onScroll = () => {
      if (window.scrollX > 0) {
        report("overflow");
      }
    };
    const onViewport = () => {
      if ((window.visualViewport?.scale ?? 1) > 1.01) {
        report("zoom");
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.visualViewport?.addEventListener("resize", onViewport);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.visualViewport?.removeEventListener("resize", onViewport);
    };
  }, []);

  return null;
}
