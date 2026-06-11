"use client";

import { useState, useEffect, type ReactNode } from "react";

export function ChartContainer({
  children,
  height = 280,
}: {
  children: ReactNode;
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="chart-container" style={{ height }} />;
  }

  return <div className="chart-container" style={{ height }}>{children}</div>;
}
