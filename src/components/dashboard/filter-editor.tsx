import { Calendar, Hash, ListFilter, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCatalog } from "@/hooks/use-api";
import { useSourceColumns } from "@/hooks/use-dashboards";
import { useSavedQueries } from "@/hooks/use-sql";
import { typeCategory } from "@/lib/column-types";
import { newId, type FilterState } from "@/lib/dashboard";
import type { FilterSpec, FilterType, Source } from "@/lib/dashboard-types";

const ICONS = { date_range: Calendar, select: ListFilter, number_range: Hash };
const TYPE_LABELS: Record<FilterType, string> = {
  date_range: "Date range",
  select: "Dropdown",
  number_range: "Number range",
};

function suggestType(type: string): FilterType {
  const category = typeCategory(type);
  return category === "date" ? "date_range" : category === "number" ? "number_range" : "select";
}

function AddFilter({ onAdd }: { onAdd: (filter: FilterSpec) => void }) {
  const catalog = useCatalog();
  const saved = useSavedQueries();
  const [source, setSource] = useState<Source>({ kind: "table", table: null });
  const [column, setColumn] = useState("");
  const [type, setType] = useState<FilterType>("select");
  const [label, setLabel] = useState("");
  const columns = useSourceColumns(source);
  const tables = catalog.data?.schemas.flatMap((s) => s.tables) ?? [];

  const sourceValue =
    source.kind === "table" ? `t:${source.table ?? ""}` : `q:${source.query_id ?? ""}`;
  const ready = !!column && (source.kind === "table" ? !!source.table : !!source.query_id);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium">Add a filter</div>
      <Select
        value={sourceValue}
        onValueChange={(value) => {
          setColumn("");
          setSource(
            value.startsWith("t:")
              ? { kind: "table", table: value.slice(2) }
              : { kind: "query", query_id: Number(value.slice(2)) },
          );
        }}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue placeholder="Data source" />
        </SelectTrigger>
        <SelectContent>
          {tables.map((t) => (
            <SelectItem
              key={`${t.schema}.${t.name}`}
              value={`t:${t.schema}.${t.name}`}
              className="text-xs"
            >
              {t.schema}.{t.name}
            </SelectItem>
          ))}
          {(saved.data ?? []).map((q) => (
            <SelectItem key={q.id} value={`q:${q.id}`} className="text-xs">
              Query: {q.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1.5">
        <Select
          value={column}
          onValueChange={(name) => {
            setColumn(name);
            const found = columns.data?.find((c) => c.name === name);
            if (found) setType(suggestType(found.type));
            setLabel((current) => current || name);
          }}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs">
            <SelectValue placeholder="Column" />
          </SelectTrigger>
          <SelectContent>
            {(columns.data ?? []).map((c) => (
              <SelectItem key={c.name} value={c.name} className="text-xs">
                <span dir="auto">{c.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => setType(v as FilterType)}>
          <SelectTrigger size="sm" className="w-32 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TYPE_LABELS) as FilterType[]).map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        dir="auto"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label"
        className="h-8 text-xs md:text-xs"
      />
      <Button
        size="sm"
        disabled={!ready}
        onClick={() => {
          onAdd({ id: newId(), type, label: label.trim() || column, source, column, multi: true });
          setColumn("");
          setLabel("");
        }}
      >
        <Plus /> Add filter
      </Button>
    </div>
  );
}

export function FilterEditorDialog({
  open,
  onOpenChange,
  filters,
  state,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterSpec[];
  state: FilterState;
  onChange: (filters: FilterSpec[]) => void;
}) {
  const update = (id: string, changes: Partial<FilterSpec>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dashboard filters</DialogTitle>
          <DialogDescription>
            A filter applies to every tile whose data has that column.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {filters.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">No filters yet.</p>
          )}
          {filters.map((filter) => {
            const Icon = ICONS[filter.type];
            const current = state[filter.id];
            return (
              <div key={filter.id} className="space-y-2 rounded-lg border p-2.5">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    dir="auto"
                    value={filter.label}
                    onChange={(e) => update(filter.id, { label: e.target.value })}
                    className="h-8 flex-1 text-sm md:text-sm"
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete filter"
                    onClick={() => onChange(filters.filter((f) => f.id !== filter.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-6 text-xs text-muted-foreground">
                  <span dir="auto">
                    {TYPE_LABELS[filter.type]} on {filter.column}
                  </span>
                  {filter.type === "select" && (
                    <label className="flex items-center gap-1.5">
                      <Checkbox
                        checked={filter.multi !== false}
                        onCheckedChange={(checked) =>
                          update(filter.id, { multi: checked === true })
                        }
                      />
                      Allow multiple
                    </label>
                  )}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => update(filter.id, { default: current ?? null })}
                  >
                    Use current value as default
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <AddFilter onAdd={(filter) => onChange([...filters, filter])} />
      </DialogContent>
    </Dialog>
  );
}
