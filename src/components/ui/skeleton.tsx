// Shimmering placeholder block, used while content (or the locale) is still loading so the UI
// never flashes default/English text before the real content arrives.
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}
