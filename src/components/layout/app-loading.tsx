import { Skeleton } from "@/components/ui/skeleton";

// Shown while the locale and settings are still loading, so the app never flashes default
// English text before the user's real locale is applied.
export function AppLoading() {
  return (
    <div className="app-loading" aria-busy="true" aria-label="Loading">
      <Skeleton className="app-loading-title" />
      <div className="app-loading-grid">
        <Skeleton className="app-loading-card" />
        <Skeleton className="app-loading-card" />
        <Skeleton className="app-loading-card" />
        <Skeleton className="app-loading-card" />
      </div>
      <Skeleton className="app-loading-block" />
      <Skeleton className="app-loading-block" />
    </div>
  );
}
