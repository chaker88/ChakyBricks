import { TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-8 py-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={title}
      description={error instanceof Error ? error.message : "Something went wrong. Try again."}
      action={
        onRetry && (
          <button
            onClick={onRetry}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        )
      }
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
