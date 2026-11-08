import { FolderOpen, Info, Monitor, Moon, Package, Sun, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AboutDialog } from "@/components/about-dialog";
import { RunningKernelsList } from "@/components/notebook/running-kernels";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSettings, useUpdateSettings } from "@/hooks/use-api";
import { useBackend } from "@/lib/backend-context";
import { pickDirectory } from "@/lib/files";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";
import { applyShellPrefs, backgroundNoticeSeen, markBackgroundNoticeSeen } from "@/lib/shell";
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
  const [aboutOpen, setAboutOpen] = useState(false);

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
        <SettingRow
          label="Default row limit"
          description="Rows loaded into the result grid. The total row count is always shown, and exports include every row."
        >
          <RowLimitSetting />
        </SettingRow>
        <SettingRow
          label="Notebook kernel memory"
          description="Share of the memory limit each notebook kernel's query engine may use. Applies to kernels started afterwards."
        >
          <KernelMemorySetting />
        </SettingRow>
        <SettingRow
          label="Background"
          description="Jobs run only while ChakyBricks is running. Keep it in the system tray to let scheduled jobs continue after you close the window."
        >
          <BackgroundSettings />
        </SettingRow>
        <SettingRow
          label="Python packages"
          description="Packages available to notebooks: install, uninstall or reset to defaults."
        >
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/packages">
              <Package />
              Manage packages
            </Link>
          </Button>
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
        <SettingRow label="About" description="Version, author, license and third-party notices.">
          <Button variant="outline" size="sm" onClick={() => setAboutOpen(true)}>
            <Info />
            About ChakyBricks
          </Button>
        </SettingRow>
      </div>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium">Keyboard shortcuts</h2>
        <div className="grid gap-x-8 gap-y-5 rounded-xl border p-4 md:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{group.title}</h3>
              <dl className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.keys} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">{item.action}</dt>
                    <dd>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap">
                        {item.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium">Running kernels</h2>
        <div className="rounded-xl border">
          <RunningKernelsList />
        </div>
      </section>
    </Page>
  );
}

function BackgroundSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [notice, setNotice] = useState(false);

  if (!settings.data) return <Skeleton className="h-16 w-72" />;
  const { keep_running_in_background, start_with_system } = settings.data;

  const change = (changes: {
    keep_running_in_background?: boolean;
    start_with_system?: boolean;
  }) => {
    const next = { keep_running_in_background, start_with_system, ...changes };
    update.mutate(changes, {
      onSuccess: () => {
        applyShellPrefs(next).catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error)),
        );
        if (
          (next.keep_running_in_background || next.start_with_system) &&
          !backgroundNoticeSeen()
        ) {
          markBackgroundNoticeSeen();
          setNotice(true);
        }
      },
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <div className="space-y-2.5">
      <label className="flex items-center justify-between gap-6 text-sm">
        Keep running in the background when the window is closed
        <Switch
          checked={keep_running_in_background}
          disabled={update.isPending}
          onCheckedChange={(value) => change({ keep_running_in_background: value })}
        />
      </label>
      <label className="flex items-center justify-between gap-6 text-sm">
        Start with the system, minimized to the tray
        <Switch
          checked={start_with_system}
          disabled={update.isPending}
          onCheckedChange={(value) => change({ start_with_system: value })}
        />
      </label>
      <AlertDialog open={notice} onOpenChange={setNotice}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Jobs only run while ChakyBricks is running</AlertDialogTitle>
            <AlertDialogDescription>
              With this option ChakyBricks stays in the system tray after you close the window, so
              scheduled jobs keep running. If you quit it from the tray menu, shut down the computer
              or sign out, jobs stop; runs that were due in the meantime are skipped, not made up
              later. Use “Pause all jobs” in the tray menu to stop schedules temporarily.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const KERNEL_SHARES = [25, 50, 75, 100];

function KernelMemorySetting() {
  const settings = useSettings();
  const update = useUpdateSettings();
  if (!settings.data) return <Skeleton className="h-8 w-48" />;
  const { kernel_memory_percent, effective_memory_limit_mb } = settings.data;
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" className="flex gap-1 rounded-lg bg-muted p-1">
        {KERNEL_SHARES.map((share) => (
          <button
            key={share}
            role="radio"
            aria-checked={kernel_memory_percent === share}
            onClick={() =>
              update.mutate(
                { kernel_memory_percent: share },
                { onError: (error) => toast.error(error.message) },
              )
            }
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
              kernel_memory_percent === share
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {share}%
          </button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        ≈ {((effective_memory_limit_mb * kernel_memory_percent) / 100 / 1024).toFixed(1)} GB
      </span>
    </div>
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

function RowLimitSetting() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<string | null>(null);

  if (!settings.data) return <Skeleton className="h-8 w-36" />;
  const current = String(settings.data.row_limit);
  const value = draft ?? current;
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 100 && parsed <= 1_000_000;

  const save = () => {
    if (!valid || value === current) return setDraft(null);
    update.mutate(
      { row_limit: parsed },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success("Row limit updated");
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        step="1000"
        min="100"
        max="1000000"
        value={value}
        aria-invalid={!valid}
        className="h-8 w-32 text-xs"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <span className="text-xs text-muted-foreground">rows (100 – 1,000,000)</span>
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
