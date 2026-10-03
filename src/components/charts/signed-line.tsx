"use client";

import { useId } from "react";
import { useXAxisScale, useYAxisScale } from "recharts";
import { line, curveMonotoneX } from "d3-shape";

// A line coloured by sign, green at or above zero and red below, whose colour change follows the
// line's own direction. Each run of one sign is drawn in its own colour; a segment that crosses zero
// gets a gradient from its start to its end, so a jump turns colour along its length, never across
// the stroke. Drawn inside a Recharts chart, from the chart's own scales.
export function SignedLine({ points, positive, negative, width }: {
  points: { x: string; y: number }[];
  positive: string;
  negative: string;
  width: number;
}) {
  const id = useId().replace(/:/g, "");
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale || points.length < 2) return null;

  const xy = points.map((p) => [Number(xScale(p.x)), Number(yScale(p.y))] as [number, number]);
  const d = line().curve(curveMonotoneX)(xy) ?? "";
  const colour = (v: number) => (v >= 0 ? positive : negative);
  const pad = width;
  const last = points.length - 1;

  // Runs of one sign as [from, to] point indexes; a crossing is the segment between two runs.
  const runs: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= last; i++) {
    if ((points[i].y >= 0) !== (points[i - 1].y >= 0)) {
      runs.push([start, i - 1]);
      start = i;
    }
  }
  runs.push([start, last]);

  const pieces: { key: string; from: number; to: number; stroke: string; gradient?: [number, number] }[] = [];
  runs.forEach(([a, b], r) => {
    pieces.push({ key: `r${r}`, from: a, to: b, stroke: colour(points[a].y) });
    if (r < runs.length - 1) pieces.push({ key: `c${r}`, from: b, to: b + 1, stroke: `url(#${id}g${r})`, gradient: [b, b + 1] });
  });

  return (
    <g>
      <defs>
        {pieces.map((p) => {
          const left = p.from === 0 ? xy[0][0] - pad : xy[p.from][0] - 0.5;
          const right = p.to === last ? xy[last][0] + pad : xy[p.to][0] + 0.5;
          return (
            <clipPath key={p.key} id={`${id}${p.key}`}>
              <rect x={left} y={-10000} width={Math.max(0, right - left)} height={20000} />
            </clipPath>
          );
        })}
        {pieces.filter((p) => p.gradient).map((p, r) => {
          const [i, j] = p.gradient!;
          return (
            <linearGradient key={p.key} id={`${id}g${r}`} gradientUnits="userSpaceOnUse" x1={xy[i][0]} y1={xy[i][1]} x2={xy[j][0]} y2={xy[j][1]}>
              <stop offset="0%" stopColor={colour(points[i].y)} />
              <stop offset="100%" stopColor={colour(points[j].y)} />
            </linearGradient>
          );
        })}
      </defs>
      {pieces.map((p) => (
        <path key={p.key} d={d} fill="none" stroke={p.stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${id}${p.key})`} />
      ))}
    </g>
  );
}
