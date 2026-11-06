import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Search, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BackendStatus } from "@/components/backend-status";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

export function TitleBar({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const native = isTauri();

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center border-b bg-titlebar pl-3 text-sm"
    >
      <div data-tauri-drag-region className="flex w-56 items-center gap-2">
        <LogoMark />
        <span data-tauri-drag-region className="font-semibold tracking-tight">
          ChakyBricks
        </span>
      </div>
      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <button
          onClick={onOpenCommandPalette}
          className="flex h-7 w-full max-w-md items-center gap-2 rounded-md border bg-background/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium">
            Ctrl K
          </kbd>
        </button>
      </div>
      <div data-tauri-drag-region className="flex w-56 items-center justify-end">
        <BackendStatus className="mr-3" />
        {native && <WindowControls />}
      </div>
    </header>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized);
    appWindow
      .onResized(() => appWindow.isMaximized().then(setMaximized))
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  const appWindow = getCurrentWindow();
  return (
    <div className="flex h-10">
      <WindowButton label="Minimize" onClick={() => appWindow.minimize()}>
        <Minus className="size-4" />
      </WindowButton>
      <WindowButton
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => appWindow.toggleMaximize()}
      >
        {maximized ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
      </WindowButton>
      <WindowButton label="Close" onClick={() => appWindow.close()} danger>
        <X className="size-4" />
      </WindowButton>
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex w-11 items-center justify-center text-muted-foreground transition-colors",
        danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
