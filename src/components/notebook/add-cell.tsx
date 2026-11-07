import { ADD_LABELS, type CellType } from "@/lib/notebook";
import { cn } from "@/lib/utils";

export function InsertBar({ onInsert }: { onInsert: (type: CellType) => void }) {
  return (
    <div className="group/insert relative flex h-8 items-center justify-center">
      <div className="absolute inset-x-6 top-1/2 h-px bg-border opacity-0 transition-opacity group-hover/insert:opacity-100" />
      <div className="relative flex gap-1 opacity-0 transition-opacity group-focus-within/insert:opacity-100 group-hover/insert:opacity-100">
        <AddCellButtons onInsert={onInsert} />
      </div>
    </div>
  );
}

export function AddCellBar({ onInsert }: { onInsert: (type: CellType) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-3">
      <AddCellButtons onInsert={onInsert} large />
    </div>
  );
}

function AddCellButtons({
  onInsert,
  large,
}: {
  onInsert: (type: CellType) => void;
  large?: boolean;
}) {
  return (
    <>
      {ADD_LABELS.map((t) => (
        <button
          key={t.value}
          onClick={() => onInsert(t.value)}
          className={cn(
            "rounded-md border bg-background text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
            large ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
          )}
        >
          + {t.label}
        </button>
      ))}
    </>
  );
}
