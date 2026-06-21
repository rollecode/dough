// Charts use recharts' default hover trigger on desktop. Touch is handled separately by
// useTouchTooltip, which maps a tap to a data index and shows the tooltip in controlled mode. This
// hook reports the trigger every chart Tooltip uses, kept as one place to change it.
export function useTooltipTrigger(): "hover" | "click" {
  return "hover";
}
