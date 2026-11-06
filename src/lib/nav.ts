import {
  CalendarClock,
  Code2,
  Database,
  House,
  LayoutDashboard,
  NotebookPen,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Home", icon: House, shortcut: "1" },
  { path: "/catalog", label: "Catalog", icon: Database, shortcut: "2" },
  { path: "/sql", label: "SQL", icon: Code2, shortcut: "3" },
  { path: "/notebooks", label: "Notebooks", icon: NotebookPen, shortcut: "4" },
  { path: "/dashboards", label: "Dashboards", icon: LayoutDashboard, shortcut: "5" },
  { path: "/jobs", label: "Jobs", icon: CalendarClock, shortcut: "6" },
  { path: "/settings", label: "Settings", icon: Settings, shortcut: "7" },
];

export function navItemForShortcut(key: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.shortcut === key);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.path === "/") return pathname === "/";
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}
