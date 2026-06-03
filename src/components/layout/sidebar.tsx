"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Receipt,
  CalendarClock,
  Wallet,
  TrendingDown,
  TrendingUp,
  Crosshair,
  CreditCard,
  Tags,
  LineChart,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/locale-context";
import { useEvent } from "@/lib/use-events";

const navKeys = [
  { href: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { href: "/net-worth", icon: LineChart, key: "netWorth" },
  { href: "/chat", icon: MessageSquare, key: "chat" },
  { href: "/transactions", icon: Receipt, key: "transactions" },
  { href: "/bills", icon: CalendarClock, key: "bills" },
  { href: "/income", icon: Wallet, key: "income" },
  { href: "/debts", icon: TrendingDown, key: "debts" },
  { href: "/investments", icon: TrendingUp, key: "investments" },
  { href: "/subscriptions", icon: CreditCard, key: "subscriptions" },
  { href: "/savings-goals", icon: Crosshair, key: "savingsGoals" },
  { href: "/categories", icon: Tags, key: "budget" },
] as const;

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  privacyMode?: boolean;
  onTogglePrivacy?: () => void;
}

export function Sidebar({ isOpen, onClose, privacyMode, onTogglePrivacy }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadTx, setUnreadTx] = useState(0);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const { t, locale } = useLocale();

  // Load current user ID
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user?.id) setMyUserId(d.user.id);
    }).catch(() => {});
  }, []);

  // Initial unread check + reset when navigating to page
  useEffect(() => {
    if (pathname === "/chat") {
      setUnreadChat(0);
      fetch("/api/chat/unread", { method: "POST" }).catch(() => {});
    } else {
      fetch("/api/chat/unread").then((r) => r.json()).then((d) => {
        setUnreadChat(d.unread || 0);
      }).catch(() => {});
    }

    if (pathname === "/transactions") {
      setUnreadTx(0);
      fetch("/api/transactions/unread", { method: "POST" }).catch(() => {});
    } else {
      fetch("/api/transactions/unread").then((r) => r.json()).then((d) => {
        setUnreadTx(d.unread || 0);
      }).catch(() => {});
    }
  }, [pathname]);

  // SSE: increment unread on new chat message (only when not on chat page)
  useEvent("chat:message", useCallback((data: unknown) => {
    const msg = data as { userId: number | null };
    if (msg.userId !== null) {
      if (pathname === "/chat") {
        // On chat page — mark as read immediately
        fetch("/api/chat/unread", { method: "POST" }).catch(() => {});
      } else {
        setUnreadChat((prev) => prev + 1);
      }
    }
  }, [pathname]));

  // SSE: show indicator on transactions only when someone else adds an expense
  useEvent("data:updated", useCallback((data: unknown) => {
    const d = data as { source?: string; userId?: number };
    if (d.source === "transaction-added" && pathname !== "/transactions" && myUserId !== null && d.userId !== myUserId) {
      setUnreadTx(1);
    }
  }, [pathname, myUserId]));

  const handleLogout = () => {
    // Use GET redirect — works on all browsers including iOS Orion
    window.location.href = "/api/auth/logout";
  };

  const handleNavClick = () => {
    onClose();
  };

  return (
    <aside
      className={cn("l-sidebar", isOpen && "is-open")}
      data-collapsed={collapsed || undefined}
    >
      {/* Logo */}
      <div className="l-sidebar-logo">
        <Link href="/dashboard" onClick={handleNavClick} className="l-sidebar-logo-link">
          {collapsed ? (
            <img src="/favicon.png" alt="Dough" className="l-sidebar-logo-icon" />
          ) : (
            <span className="l-sidebar-logo-text">Dough</span>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="l-sidebar-collapse-btn"
        >
          {collapsed ? <ChevronRight className="l-sidebar-collapse-icon" /> : <ChevronLeft className="l-sidebar-collapse-icon" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="l-sidebar-nav">
        {navKeys.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleNavClick}
              className={cn(
                "l-sidebar-link",
                isActive && "is-active"
              )}
            >
              <item.icon className="l-sidebar-link-icon" />
              {!collapsed && <span>{t.nav[item.key]}</span>}
              {item.key === "chat" && unreadChat > 0 && !isActive && (
                <span className="l-sidebar-badge">{unreadChat}</span>
              )}
              {item.key === "transactions" && unreadTx > 0 && !isActive && (
                <span className="l-sidebar-badge-dot" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="l-sidebar-bottom">
        <Link
          href="/settings"
          onClick={handleNavClick}
          className={cn(
            "l-sidebar-link",
            pathname === "/settings" && "is-active"
          )}
        >
          <Settings className="l-sidebar-link-icon" />
          {!collapsed && <span>{t.common.settings}</span>}
        </Link>
        {onTogglePrivacy && (
          <button
            type="button"
            onClick={onTogglePrivacy}
            className="l-sidebar-link"
          >
            {privacyMode ? <EyeOff className="l-sidebar-link-icon" /> : <Eye className="l-sidebar-link-icon" />}
            {!collapsed && <span>{privacyMode ? (locale === "fi" ? "Näytä tiedot" : "Show data") : (locale === "fi" ? "Piilota tiedot" : "Hide data")}</span>}
          </button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="l-sidebar-link"
        >
          <LogOut className="l-sidebar-link-icon" />
          {!collapsed && <span>{t.common.logout}</span>}
        </button>
      </div>
    </aside>
  );
}
