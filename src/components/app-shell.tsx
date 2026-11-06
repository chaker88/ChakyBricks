import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { CommandPalette } from "@/components/command-palette";
import { NavRail } from "@/components/nav-rail";
import { TitleBar } from "@/components/title-bar";
import { navItemForShortcut } from "@/lib/nav";

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const item = navItemForShortcut(event.key);
      if (item) {
        event.preventDefault();
        navigate(item.path);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar onOpenCommandPalette={() => setPaletteOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
