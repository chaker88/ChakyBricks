import {
  ChevronRight,
  Database,
  FolderPlus,
  MoreHorizontal,
  Search,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { NewSchemaDialog } from "@/components/catalog/new-schema-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCatalog, useDropSchema } from "@/hooks/use-api";
import { filterCatalog } from "@/lib/catalog";
import { typeIcon } from "@/lib/column-types";
import { useImport } from "@/lib/import-context";
import { cn } from "@/lib/utils";

export function CatalogTree() {
  const { data, isLoading } = useCatalog();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [schemaDialog, setSchemaDialog] = useState(false);
  const dropSchema = useDropSchema();
  const { openImport } = useImport();

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const filtered = data ? filterCatalog(data, query) : null;
  const searching = query.trim() !== "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <h2 className="flex-1 text-sm font-semibold">Catalog</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setSchemaDialog(true)}
            >
              <FolderPlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New schema</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={openImport}>
              <Upload className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import data</TooltipContent>
        </Tooltip>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tables and columns"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 text-[13px]">
        {isLoading || !filtered ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="ml-4 h-5 w-1/2" />
            <Skeleton className="ml-4 h-5 w-3/5" />
          </div>
        ) : filtered.schemas.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</p>
        ) : (
          filtered.schemas.map((schema) => {
            const open = searching || !collapsed.has(schema.name);
            return (
              <div key={schema.name}>
                <div className="group flex items-center rounded-md hover:bg-accent/60">
                  <button
                    onClick={() => setCollapsed((c) => toggle(c, schema.name))}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    <Database className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{schema.name}</span>
                    <span className="ml-auto pr-1 text-[11px] text-muted-foreground">
                      {schema.tables.length}
                    </span>
                  </button>
                  {schema.name !== "main" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground data-[state=open]:opacity-100">
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            dropSchema.mutate(schema.name, {
                              onError: (error) => toast.error(error.message),
                            })
                          }
                        >
                          <Trash2 />
                          Drop schema
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {open && (
                  <div className="ml-3 border-l pl-1.5">
                    {schema.tables.length === 0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">No tables</p>
                    )}
                    {schema.tables.map((table) => {
                      const key = `${schema.name}.${table.name}`;
                      const showColumns =
                        (searching && !table.name.includes(query.trim().toLowerCase())) ||
                        expandedTables.has(key);
                      return (
                        <div key={key}>
                          <div className="flex items-center">
                            <button
                              aria-label={showColumns ? "Hide columns" : "Show columns"}
                              onClick={() => setExpandedTables((e) => toggle(e, key))}
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3.5 transition-transform",
                                  showColumns && "rotate-90",
                                )}
                              />
                            </button>
                            <NavLink
                              to={`/catalog/${schema.name}/${table.name}`}
                              className={({ isActive }) =>
                                cn(
                                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1",
                                  isActive
                                    ? "bg-accent font-medium text-foreground"
                                    : "text-foreground/85 hover:bg-accent/60",
                                )
                              }
                            >
                              <Table2 className="size-3.5 shrink-0 text-primary" />
                              <span className="truncate">{table.name}</span>
                            </NavLink>
                          </div>
                          {showColumns && (
                            <div className="ml-5 border-l py-0.5 pl-2">
                              {table.columns.map((column) => {
                                const Icon = typeIcon(column.type);
                                return (
                                  <div
                                    key={column.name}
                                    className="flex items-center gap-1.5 px-1 py-0.5 text-xs"
                                    title={`${column.name} ${column.type}`}
                                  >
                                    <Icon className="size-3 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{column.name}</span>
                                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                      {column.type}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <NewSchemaDialog open={schemaDialog} onOpenChange={setSchemaDialog} />
    </div>
  );
}
