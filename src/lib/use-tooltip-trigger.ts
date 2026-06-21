// Charts use recharts' default hover trigger. A stationary tap on a touch screen produces neither a
// hover nor a touch-move, so it would show no tooltip; that gap is bridged globally by
// ChartTouchTooltips (mounted in the app layout), which turns a tap into a synthetic mousemove. This
// hook reports the trigger every chart Tooltip uses, kept as one place to change it.
export function useTooltipTrigger(): "hover" | "click" {
  return "hover";
}
