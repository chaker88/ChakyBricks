import { NAV_ITEMS } from "@/lib/nav";

export interface ShortcutGroup {
  title: string;
  items: { keys: string; action: string }[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Everywhere",
    items: [
      { keys: "Ctrl+K", action: "Open the command palette" },
      ...NAV_ITEMS.map((item) => ({
        keys: `Ctrl+${item.shortcut}`,
        action: `Go to ${item.label}`,
      })),
    ],
  },
  {
    title: "SQL editor",
    items: [
      { keys: "Ctrl+Enter", action: "Run the selection, or the whole query" },
      { keys: "Ctrl+Shift+Enter", action: "Run all statements" },
      { keys: "Ctrl+S", action: "Save the query" },
      { keys: "Ctrl+Space", action: "Show suggestions" },
    ],
  },
  {
    title: "Notebooks",
    items: [
      { keys: "Shift+Enter", action: "Run the cell and move to the next one" },
      { keys: "Ctrl+Enter", action: "Run the cell and stay" },
      { keys: "Alt+Enter", action: "Run the cell and insert a new one below" },
    ],
  },
  {
    title: "Dashboards (edit mode)",
    items: [
      { keys: "Ctrl+S", action: "Save the dashboard" },
      { keys: "Delete", action: "Delete the selected tile" },
      { keys: "Esc", action: "Deselect the tile" },
    ],
  },
  {
    title: "Dashboards (view mode)",
    items: [{ keys: "Ctrl/Shift+click", action: "Add to the cross-filter" }],
  },
];
