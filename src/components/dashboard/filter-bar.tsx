import { Calendar, Check, ChevronDown, Hash, ListFilter, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFilterOptions } from "@/hooks/use-dashboards";
import {
  DATE_PRESETS,
  datePresetLabel,
  filterIsActive,
  resolveFilterDates,
  type FilterState,
} from "@/lib/dashboard";
import type { CrossFilter, FilterSpec, FilterValue } from "@/lib/dashboard-types";
import { formatValue } from "@/lib/number-format";
import { cn } from "@/lib/utils";

interface ControlProps {
  filter: FilterSpec;
  value: FilterValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
}

function ControlButton({
  icon: Icon,
  label,
  summary,
  active,
  ...props
}: {
  icon: typeof Calendar;
  label: string;
  summary: string;
  active: boolean;
} & Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Button
      variant="outline"
      size="sm"
      {...props}
      className={cn("h-8 gap-1.5 bg-card font-normal", active && "border-primary/50")}
    >
      <Icon className="size-3.5 text-muted-foreground" />
      <span dir="auto" className="text-muted-foreground">
        {label}
      </span>
      <span dir="auto" className="max-w-40 truncate font-medium">
        {summary}
      </span>
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </Button>
  );
}

function DateRangeControl({ filter, value, onChange }: ControlProps) {
  const range = resolveFilterDates(value ?? {});
  const [custom, setCustom] = useState<{ start: string; end: string }>({
    start: range.start ?? "",
    end: range.end ?? "",
  });
  const activePreset = value?.preset ?? (filterIsActive(filter, value) ? null : "all_time");
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCustom({ start: range.start ?? "", end: range.end ?? "" });
      }}
    >
      <PopoverTrigger asChild>
        <ControlButton
          icon={Calendar}
          label={filter.label || filter.column}
          summary={datePresetLabel(value)}
          active={filterIsActive(filter, value)}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-72 overflow-y-auto">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onChange(preset.id === "all_time" ? undefined : { preset: preset.id });
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {preset.label}
              {activePreset === preset.id && <Check className="size-4" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
        <div className="mt-1 space-y-2 border-t p-2">
          <div className="text-xs font-medium text-muted-foreground">Custom range</div>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={custom.start}
              onChange={(e) => setCustom({ ...custom, start: e.target.value })}
              className="h-8 px-2 text-xs"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              value={custom.end}
              onChange={(e) => setCustom({ ...custom, end: e.target.value })}
              className="h-8 px-2 text-xs"
            />
          </div>
          <Button
            size="xs"
            className="w-full"
            disabled={!custom.start && !custom.end}
            onClick={() => {
              onChange({ start: custom.start || null, end: custom.end || null });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SelectControl({ filter, value, onChange }: ControlProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 200);
  const options = useFilterOptions(filter.source, filter.column, debounced, open);
  const selected = value?.values ?? [];
  const multi = filter.multi !== false;
  const summary =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? String(selected[0])
        : `${selected.length} selected`;

  const toggle = (item: string | number | boolean) => {
    if (!multi) {
      onChange(selected[0] === item ? undefined : { values: [item] });
      setOpen(false);
      return;
    }
    const next = selected.includes(item) ? selected.filter((v) => v !== item) : [...selected, item];
    onChange(next.length ? { values: next } : undefined);
  };

  const data = options.data?.kind === "values" ? options.data : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <ControlButton
          icon={ListFilter}
          label={filter.label || filter.column}
          summary={summary}
          active={selected.length > 0}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search values…" value={search} onValueChange={setSearch} />
          <CommandList>
            {options.isPending && (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
            )}
            {options.isError && (
              <div className="px-3 py-6 text-center text-sm text-destructive">
                {options.error.message}
              </div>
            )}
            {data && data.values.length === 0 && <CommandEmpty>No matching values</CommandEmpty>}
            <CommandGroup>
              {(data?.values ?? []).map((item) => {
                if (item === null || typeof item === "object") return null;
                const checked = selected.includes(item);
                return (
                  <CommandItem
                    key={String(item)}
                    value={String(item)}
                    onSelect={() => toggle(item)}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border",
                        multi ? "" : "rounded-full",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "opacity-60",
                      )}
                    >
                      {checked && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span dir="auto" className="truncate">
                      {String(item)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {data?.truncated && (
              <div className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                Showing the first {data.values.length} values — type to search
              </div>
            )}
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t p-1">
              <Button
                size="xs"
                variant="ghost"
                className="w-full"
                onClick={() => onChange(undefined)}
              >
                Clear selection
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function NumberRangeControl({ filter, value, onChange }: ControlProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ min: "", max: "" });
  const options = useFilterOptions(filter.source, filter.column, "", open);
  const range = options.data?.kind === "range" ? options.data : null;
  const active = filterIsActive(filter, value);
  const summary = active ? `${value?.minimum ?? "…"} – ${value?.maximum ?? "…"}` : "Any";
  const toNumber = (text: string) =>
    text.trim() === "" || Number.isNaN(Number(text)) ? null : Number(text);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next)
          setDraft({ min: String(value?.minimum ?? ""), max: String(value?.maximum ?? "") });
      }}
    >
      <PopoverTrigger asChild>
        <ControlButton
          icon={Hash}
          label={filter.label || filter.column}
          summary={summary}
          active={active}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        {range && (
          <p className="text-xs text-muted-foreground">
            Data ranges from {formatValue(Number(range.minimum), undefined, false)} to{" "}
            {formatValue(Number(range.maximum), undefined, false)}
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <Input
            inputMode="decimal"
            placeholder="Min"
            value={draft.min}
            onChange={(e) => setDraft({ ...draft, min: e.target.value })}
            className="h-8 text-xs"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            inputMode="decimal"
            placeholder="Max"
            value={draft.max}
            onChange={(e) => setDraft({ ...draft, max: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="xs"
            className="flex-1"
            onClick={() => {
              const minimum = toNumber(draft.min);
              const maximum = toNumber(draft.max);
              onChange(minimum === null && maximum === null ? undefined : { minimum, maximum });
              setOpen(false);
            }}
          >
            Apply
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({
  filters,
  state,
  onChange,
  onReset,
  crossFilters,
  onClearCross,
  editing,
  onEditFilters,
}: {
  filters: FilterSpec[];
  state: FilterState;
  onChange: (id: string, value: FilterValue | undefined) => void;
  onReset: () => void;
  crossFilters: CrossFilter[];
  onClearCross: (tileId: string | null) => void;
  editing: boolean;
  onEditFilters: () => void;
}) {
  const anyActive = filters.some((f) => filterIsActive(f, state[f.id]));
  if (filters.length === 0 && crossFilters.length === 0 && !editing) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-filter-bar>
      {filters.map((filter) => {
        const props = {
          filter,
          value: state[filter.id],
          onChange: (value: FilterValue | undefined) => onChange(filter.id, value),
        };
        if (filter.type === "date_range") return <DateRangeControl key={filter.id} {...props} />;
        if (filter.type === "number_range")
          return <NumberRangeControl key={filter.id} {...props} />;
        return <SelectControl key={filter.id} {...props} />;
      })}
      {crossFilters.map((cross) => (
        <span
          key={cross.tileId}
          dir="auto"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 pr-1 pl-2.5 text-sm"
        >
          <span className="max-w-48 truncate">{cross.labels.join(", ")}</span>
          <button
            type="button"
            aria-label="Remove cross-filter"
            onClick={() => onClearCross(cross.tileId)}
            className="rounded p-1 text-muted-foreground hover:bg-primary/20 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {(anyActive || crossFilters.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => {
            onReset();
            onClearCross(null);
          }}
        >
          Reset
        </Button>
      )}
      {editing && (
        <Button variant="ghost" size="sm" className="ml-auto h-8" onClick={onEditFilters}>
          <Pencil className="size-3.5" />
          Edit filters
        </Button>
      )}
    </div>
  );
}
