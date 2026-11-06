import { Database, Upload } from "lucide-react";
import { Outlet } from "react-router";
import { CatalogTree } from "@/components/catalog/catalog-tree";
import { EmptyState, Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/hooks/use-api";
import { formatBytes, formatNumber } from "@/lib/format";
import { useImport } from "@/lib/import-context";

export function CatalogLayout() {
  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 border-r">
        <CatalogTree />
      </aside>
      <div className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

export function CatalogHome() {
  const { data } = useCatalog();
  const { openImport } = useImport();
  const tables = data?.schemas.flatMap((s) => s.tables) ?? [];
  const rows = tables.reduce((sum, t) => sum + t.row_count, 0);
  const bytes = tables.reduce((sum, t) => sum + t.size_bytes, 0);

  return (
    <Page
      title="Catalog"
      description="Delta tables in your workspace — queryable from SQL and Python by the same name."
      actions={
        <Button onClick={openImport}>
          <Upload />
          Import data
        </Button>
      }
    >
      {tables.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No tables yet"
          description="Import a CSV, Parquet, JSON or Excel file to create your first Delta table. It becomes queryable from both SQL and Python."
          action={<Button onClick={openImport}>Import data</Button>}
        />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Schemas" value={formatNumber(data?.schemas.length ?? 0)} />
          <Stat label="Tables" value={formatNumber(tables.length)} />
          <Stat label="Total rows" value={formatNumber(rows)} hint={formatBytes(bytes)} />
        </div>
      )}
    </Page>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
