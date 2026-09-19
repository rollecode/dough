"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { FabAddExpense } from "./fab-add-expense";
import { AppVersion } from "./app-version";
import { GlassPointer } from "./glass-pointer";
import { InfoPopupPosition } from "./info-popup-position";
import { PanelLeft, Eye, EyeOff } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const { t, privacyMode, setPrivacyMode } = useLocale();

  return (
    <div className={`l-app-shell ${privacyMode ? "privacy-mode" : ""}`}>
      {/* Mobile top bar */}
      <div className="l-topbar">
        <button
          className="l-topbar-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label={t.common.openMenu}
        >
          <PanelLeft />
        </button>
        <span className="l-topbar-title">Dough</span>
        <button
          className="l-topbar-btn"
          onClick={() => setPrivacyMode(!privacyMode)}
        >
          {privacyMode ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {/* Sidebar overlay for mobile */}
      <div
        className={`l-sidebar-overlay ${sidebarOpen ? "is-open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        privacyMode={privacyMode}
        onTogglePrivacy={() => setPrivacyMode(!privacyMode)}
        collapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed((v) => !v)}
      />

      <main className="l-main" data-collapsed={navCollapsed || undefined}>
        <div className="l-page-container">
          {children}
        </div>
        <AppVersion />
      </main>

      <FabAddExpense />
      <GlassPointer />
      <InfoPopupPosition />
    </div>
  );
}
