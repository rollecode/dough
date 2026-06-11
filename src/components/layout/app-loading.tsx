import { Skeleton } from "@/components/ui/skeleton";

// Shown while the locale and settings are still loading. Mirrors the real app shell — sidebar,
// mobile top bar, and page content — with placeholders where the actual content sits, so the UI
// is recognisable while loading instead of a couple of stray blocks. No text, so no locale is
// needed and the app never flashes default English.
export function AppLoading() {
  return (
    <div className="app-loading-shell" aria-busy="true" aria-label="Loading">
      <aside className="app-loading-sidebar">
        <div className="app-loading-logo"><Skeleton className="app-loading-logo-mark" /></div>
        <div className="app-loading-nav">
          {Array.from({ length: 10 }).map((_, i) => (
            <div className="app-loading-nav-item" key={i}>
              <Skeleton className="app-loading-nav-icon" />
              <Skeleton className="app-loading-nav-label" />
            </div>
          ))}
        </div>
      </aside>

      <div className="app-loading-topbar">
        <Skeleton className="app-loading-topbar-btn" />
        <Skeleton className="app-loading-topbar-title" />
        <Skeleton className="app-loading-topbar-btn" />
      </div>

      <main className="app-loading-main">
        <div className="app-loading-page">
          <Skeleton className="app-loading-heading" />
          <div className="app-loading-grid">
            <Skeleton className="app-loading-card" />
            <Skeleton className="app-loading-card" />
            <Skeleton className="app-loading-card" />
            <Skeleton className="app-loading-card" />
          </div>
          <div className="app-loading-row2">
            <Skeleton className="app-loading-block" />
            <Skeleton className="app-loading-block" />
          </div>
          <Skeleton className="app-loading-block" />
        </div>
      </main>
    </div>
  );
}
