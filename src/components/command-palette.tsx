import { Code2, Moon, NotebookPen, Sun, Table2, Upload } from "lucide-react";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useCatalog } from "@/hooks/use-api";
import { useImport } from "@/lib/import-context";
import { NAV_ITEMS } from "@/lib/nav";
import { useTheme } from "@/lib/theme";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { openImport } = useImport();
  const catalog = useCatalog();
  const tables = catalog.data?.schemas.flatMap((s) => s.tables) ?? [];

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Go to">
          {NAV_ITEMS.map((item) => (
            <CommandItem key={item.path} onSelect={() => run(() => navigate(item.path))}>
              <item.icon />
              {item.label}
              <CommandShortcut>Ctrl {item.shortcut}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(openImport)}>
            <Upload />
            Import data
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate("/sql?new=1"))}>
            <Code2 />
            New query
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate("/notebooks?new=1"))}>
            <NotebookPen />
            New notebook
          </CommandItem>
        </CommandGroup>
        {tables.length > 0 && (
          <CommandGroup heading="Tables">
            {tables.map((table) => {
              const fullName = `${table.schema}.${table.name}`;
              return (
                <CommandItem
                  key={fullName}
                  value={`table ${fullName}`}
                  onSelect={() => run(() => navigate(`/catalog/${table.schema}/${table.name}`))}
                >
                  <Table2 />
                  {fullName}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => run(toggle)}>
            {theme === "dark" ? <Sun /> : <Moon />}
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
