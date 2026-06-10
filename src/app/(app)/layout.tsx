import { AppShell } from "@/components/layout/app-shell";
import { AppVersion } from "@/components/layout/app-version";
import { LocaleProvider } from "@/lib/locale-context";
import { YnabProvider } from "@/lib/ynab-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <YnabProvider>
        <AppShell>{children}</AppShell>
        <AppVersion />
      </YnabProvider>
    </LocaleProvider>
  );
}
