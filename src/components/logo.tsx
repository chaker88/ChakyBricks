import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-5", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g className="fill-primary-foreground">
        <rect x="6" y="8" width="11" height="4.5" rx="1.25" />
        <rect x="19" y="8" width="7" height="4.5" rx="1.25" />
        <rect x="6" y="14.25" width="5" height="4.5" rx="1.25" />
        <rect x="13" y="14.25" width="13" height="4.5" rx="1.25" />
        <rect x="6" y="20.5" width="11" height="4.5" rx="1.25" opacity="0.65" />
        <rect x="19" y="20.5" width="7" height="4.5" rx="1.25" opacity="0.65" />
      </g>
    </svg>
  );
}
