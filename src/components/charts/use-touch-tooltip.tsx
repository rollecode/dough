"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlotArea } from "recharts";

// Reports the chart's plot area (it can only be read from inside the chart, via usePlotArea) up to
// the touch handler, which lives on the wrapper div.
function PlotAreaReporter({ onArea }: { onArea: (a: { x: number; width: number }) => void }) {
  const area = usePlotArea();
  const w = area?.width;
  const x = area?.x;
  useEffect(() => {
    if (typeof x === "number" && typeof w === "number") onArea({ x, width: w });
  }, [x, w, onArea]);
  return null;
}

// Touch-driven tooltip for recharts. iOS Safari does not fire the mouse events recharts needs to show
// a tooltip on a stationary tap (it only does so for "clickable" elements, and even then unreliably).
// So we drive the tooltip from touch events directly: a tap maps to the nearest data index (via the
// plot area), and the Tooltip is shown in controlled mode at that index. Desktop hover is untouched -
// `active` is left undefined when no touch is in progress, so recharts keeps its normal hover control.
export function useTouchTooltip(dataLength: number) {
  const [index, setIndex] = useState<number | null>(null);
  const areaRef = useRef<{ x: number; width: number } | null>(null);
  const onArea = useCallback((a: { x: number; width: number }) => { areaRef.current = a; }, []);

  const onTouch = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const area = areaRef.current;
    if (!t || !area || area.width <= 0 || dataLength < 1) return;
    const surf = (e.currentTarget as HTMLElement).querySelector(".recharts-surface");
    if (!surf) return;
    const r = surf.getBoundingClientRect();
    const xInPlot = t.clientX - r.left - area.x;
    const i = Math.max(0, Math.min(dataLength - 1, Math.round((xInPlot / area.width) * (dataLength - 1))));
    setIndex(i);
  }, [dataLength]);

  const clear = useCallback(() => setIndex(null), []);

  // Touch handlers to spread on a div that contains the chart (any ancestor - events bubble up).
  const handlers = {
    onTouchStart: onTouch,
    onTouchMove: onTouch,
    onTouchEnd: clear,
    onTouchCancel: clear,
  };

  return {
    handlers,
    // Convenience: a full-size wrapper div's props (handlers + sizing) for charts whose parent is
    // already sized (ResponsiveContainer height="100%").
    wrapperProps: { ...handlers, style: { width: "100%", height: "100%", touchAction: "pan-y" as const } },
    // Render inside the chart (e.g. before <Tooltip/>).
    reporter: <PlotAreaReporter onArea={onArea} />,
    // Spread on the chart's <Tooltip/>. active stays undefined off-touch so desktop hover still works.
    tooltipProps: { active: index != null ? true : undefined, defaultIndex: index ?? undefined },
  };
}
