import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Page } from "@/components/page";
import { useBackend } from "@/lib/backend-context";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const backend = useBackend();

  return (
    <Page title="Settings" description="Appearance, workspace and engine preferences.">
      <div className="divide-y rounded-xl border">
        <SettingRow label="Theme" description="Choose how ChakyBricks looks.">
          <div role="radiogroup" className="flex gap-1 rounded-lg bg-muted p-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                role="radio"
                aria-checked={preference === value}
                onClick={() => setPreference(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  preference === value
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow
          label="Workspace folder"
          description="Where tables, notebooks and metadata are stored."
        >
          <span className="text-xs text-muted-foreground">Available after data setup</span>
        </SettingRow>
        <SettingRow label="Memory limit" description="Maximum memory the query engine may use.">
          <span className="text-xs text-muted-foreground">60% of system RAM</span>
        </SettingRow>
        <SettingRow label="Default row limit" description="Rows returned to the result grid.">
          <span className="text-xs text-muted-foreground">10,000</span>
        </SettingRow>
        <SettingRow label="Engine" description="Local backend process status.">
          <span className="text-xs text-muted-foreground">
            {backend.status === "ready"
              ? `v${backend.health.version} · ${backend.client.baseUrl}`
              : backend.status === "error"
                ? "Offline"
                : "Starting…"}
          </span>
        </SettingRow>
      </div>
    </Page>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  );
}
