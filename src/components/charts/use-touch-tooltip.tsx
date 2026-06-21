"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlotArea } from "recharts";

// Reports the chart's plot area (only readable from inside the chart, via usePlotArea) up to the
// touch handler, which lives on the wrapper div.
function PlotAreaReporter({ onArea }: { onArea: (a: { x: number; width: number }) => void }) {
  const area = usePlotArea();
  const w = area?.width;
  const x = area?.x;
  useEffect(() => {
    if (typeof x === "number" && typeof w === "number") onArea({ x, width: w });
  }, [x, w, onArea]);
  return null;
}

// Touch/click-driven tooltip for recharts. iOS Safari does not fire the mouse events recharts needs
// to show a tooltip on a stationary tap, so we drive it ourselves: a tap (or drag) maps to the
// nearest data index and the Tooltip is shown in controlled mode at that index. Crucially the
// tooltip STAYS after the finger lifts (it is cleared only by tapping outside the chart) - clearing
// on touchend made it flash and vanish on a real tap. Modeled on the info-button popups, which work
// on iOS because they are click + state, not hover. Desktop hover is untouched: `active` is left
// undefined when nothing is selected, so recharts keeps its normal hover control.
export function useTouchTooltip(dataLength: number) {
  const [index, setIndex] = useState<number | null>(null);
  const areaRef = useRef<{ x: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const onArea = useCallback((a: { x: number; width: number }) => { areaRef.current = a; }, []);

  const selectAt = useCallback((clientX: number, container: HTMLElement) => {
    const area = areaRef.current;
    if (!area || area.width <= 0 || dataLength < 1) return;
    const surf = container.querySelector(".recharts-surface");
    if (!surf) return;
    const r = surf.getBoundingClientRect();
    const xInPlot = clientX - r.left - area.x;
    const i = Math.max(0, Math.min(dataLength - 1, Math.round((xInPlot / area.width) * (dataLength - 1))));
    setIndex(i);
  }, [dataLength]);

  const onTouch = useCallback((e: React.TouchEvent<HTMLElement>) => {
    const t = e.touches[0];
    if (t) selectAt(t.clientX, e.currentTarget);
  }, [selectAt]);

  const onClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    selectAt(e.clientX, e.currentTarget);
  }, [selectAt]);

  // A real mouse move means a pointer device (or Android's tap-synthesized mouse events): hand the
  // tooltip back to recharts' native hover. iOS fires no mousemove on a tap, so there the
  // touch-selected index simply persists and the tooltip stays put.
  const onMouseMove = useCallback(() => setIndex((i) => (i == null ? i : null)), []);

  // Dismiss when tapping/clicking outside this chart (the tooltip otherwise stays put after a tap).
  useEffect(() => {
    if (index == null) return;
    const onDown = (e: Event) => {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) setIndex(null);
    };
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("mousedown", onDown);
    };
  }, [index]);

  const handlers = {
    ref: wrapRef,
    onTouchStart: onTouch,
    onTouchMove: onTouch,
    onClick,
    onMouseMove,
  };

  return {
    handlers,
    wrapperProps: { ...handlers, style: { width: "100%", height: "100%", touchAction: "pan-y" as const } },
    reporter: <PlotAreaReporter onArea={onArea} />,
    tooltipProps: { active: index != null ? true : undefined, defaultIndex: index ?? undefined },
  };
}
