import { FolderOpen, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings, useUpdateSettings } from "@/hooks/use-api";
import { useBackend } from "@/lib/backend-context";
import { pickDirectory } from "@/lib/files";
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
          description="Where tables, notebooks and metadata are stored. Existing data stays in the old folder."
        >
          <WorkspaceSetting />
        </SettingRow>
        <SettingRow
          label="Memory limit"
          description="Maximum memory the query engine may use before spilling to disk."
        >
          <MemoryLimitSetting />
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

function WorkspaceSetting() {
  const settings = useSettings();
  const update = useUpdateSettings();

  const change = async () => {
    const folder = await pickDirectory("Choose workspace folder");
    if (!folder) return;
    update.mutate(
      { workspace: folder },
      {
        onSuccess: (s) => toast.success(`Workspace moved to ${s.workspace}`),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  if (!settings.data) return <Skeleton className="h-8 w-64" />;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code
        className="max-w-80 truncate rounded bg-muted px-2 py-1 text-xs select-text"
        title={settings.data.workspace}
      >
        {settings.data.workspace}
      </code>
      <Button variant="outline" size="sm" disabled={update.isPending} onClick={change}>
        <FolderOpen />
        Change…
      </Button>
    </div>
  );
}

function MemoryLimitSetting() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<string | null>(null);

  if (!settings.data) return <Skeleton className="h-8 w-48" />;
  const { memory_limit_mb, default_memory_limit_mb, total_memory_mb } = settings.data;
  const current = memory_limit_mb ? (memory_limit_mb / 1024).toFixed(1) : "";
  const value = draft ?? current;
  const parsed = Number(value);
  const valid = value === "" || (parsed >= 0.25 && parsed * 1024 <= total_memory_mb);

  const save = () => {
    if (!valid || value === current) return setDraft(null);
    update.mutate(
      { memory_limit_mb: value === "" ? null : Math.round(parsed * 1024) },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success("Memory limit updated");
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Input
          type="number"
          step="0.5"
          min="0.25"
          value={value}
          aria-invalid={!valid}
          placeholder={`${(default_memory_limit_mb / 1024).toFixed(1)} (default)`}
          className="h-8 w-36 pr-9 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
          GB
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        of {(total_memory_mb / 1024).toFixed(1)} GB
      </span>
      {memory_limit_mb !== null && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            update.mutate({ memory_limit_mb: null }, { onSuccess: () => setDraft(null) })
          }
        >
          Reset
        </Button>
      )}
    </div>
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
