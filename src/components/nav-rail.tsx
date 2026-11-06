import { NavLink, useLocation } from "react-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS, isNavItemActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function NavRail() {
  const { pathname } = useLocation();
  const main = NAV_ITEMS.filter((item) => item.path !== "/settings");
  const settings = NAV_ITEMS.filter((item) => item.path === "/settings");

  const renderItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isNavItemActive(item, pathname);
    return (
      <Tooltip key={item.path}>
        <TooltipTrigger asChild>
          <NavLink
            to={item.path}
            aria-label={item.label}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-lg transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {active && (
              <span className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-primary" />
            )}
            <item.icon className="size-[18px]" strokeWidth={1.75} />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {item.label}
          <span className="opacity-60">Ctrl {item.shortcut}</span>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-rail py-2">
      {main.map(renderItem)}
      <div className="flex-1" />
      {settings.map(renderItem)}
    </nav>
  );
}
