"use client";

import { useEffect } from "react";

// iOS Safari only dispatches mouse events (mouseover, mousemove, ...) when you tap an element it
// considers "clickable": one that has an onclick handler or cursor:pointer. A plain SVG chart is not
// clickable, so a tap on it fires nothing and the hover tooltip never appears - even though desktop
// hover and Android (which synthesize mouse events freely) work. So we mark every recharts chart
// clickable; then on iOS a tap produces the mouseover/mousemove that drives the normal hover tooltip.
// Done globally via a MutationObserver so it covers every chart, including ones rendered after data
// loads. See Apple's Safari Web Content Guide, "One-Finger Events" / making elements clickable.
export function ChartTouchTooltips() {
  useEffect(() => {
    const noop = () => {};
    const mark = (el: Element) => {
      const e = el as HTMLElement & { __tapTip?: boolean };
      if (e.__tapTip) return;
      e.__tapTip = true;
      e.style.cursor = "pointer";
      e.onclick = noop; // the onclick property is what iOS checks to treat a tap as "clickable"
    };
    const scan = (node: Node) => {
      if (node.nodeType !== 1) return;
      const el = node as Element;
      if (el.matches?.(".recharts-wrapper, .recharts-surface")) mark(el);
      el.querySelectorAll?.(".recharts-wrapper, .recharts-surface").forEach(mark);
    };
    scan(document.body);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach(scan);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
