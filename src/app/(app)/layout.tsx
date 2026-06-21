import { AppShell } from "@/components/layout/app-shell";
import { LocaleProvider } from "@/lib/locale-context";
import { YnabProvider } from "@/lib/ynab-context";
import { TouchTooltips } from "@/components/shared/touch-tooltips";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <YnabProvider>
        <AppShell>{children}</AppShell>
        <TouchTooltips />
      </YnabProvider>
    </LocaleProvider>
  );
}
