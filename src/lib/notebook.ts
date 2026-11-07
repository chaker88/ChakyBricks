export type CellType = "python" | "sql" | "markdown";
export type CellStatus = "idle" | "queued" | "running" | "ok" | "error" | "aborted";

export type MimeBundle = Record<string, unknown>;

export type Output =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | {
      output_type: "execute_result";
      data: MimeBundle;
      metadata: Record<string, unknown>;
      execution_count: number | null;
    }
  | { output_type: "display_data"; data: MimeBundle; metadata: Record<string, unknown> }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

export interface Cell {
  id: string;
  type: CellType;
  source: string;
  outputs: Output[];
  executionCount: number | null;
  status: CellStatus;
  durationMs: number | null;
  editing: boolean;
  clearOnNextOutput: boolean;
  metadata: Record<string, unknown>;
}

export interface NotebookDoc {
  cells: Cell[];
  metadata: Record<string, unknown>;
  nbformatMinor: number;
}

interface IpynbCell {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: Output[];
  execution_count?: number | null;
}

export interface Ipynb {
  cells: IpynbCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export const TABLE_MIME = "application/vnd.chakybricks.table+json";
export const PLOTLY_MIME = "application/vnd.plotly.v1+json";

export function newCellId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function joinText(value: unknown): string {
  if (Array.isArray(value)) return value.join("");
  return typeof value === "string" ? value : "";
}

export function makeCell(type: CellType, source = ""): Cell {
  return {
    id: newCellId(),
    type,
    source,
    outputs: [],
    executionCount: null,
    status: "idle",
    durationMs: null,
    editing: type === "markdown" && !source,
    clearOnNextOutput: false,
    metadata: {},
  };
}

function normalizeOutput(output: Output): Output {
  if (output.output_type === "stream") return { ...output, text: joinText(output.text) };
  if (output.output_type === "error") return output;
  const data: MimeBundle = {};
  for (const [mime, value] of Object.entries(output.data ?? {})) {
    data[mime] = Array.isArray(value) && mime.startsWith("text/") ? value.join("") : value;
  }
  return { ...output, data };
}

export function fromIpynb(notebook: Ipynb): NotebookDoc {
  const cells = notebook.cells
    .filter((c) => c.cell_type !== "raw")
    .map((c): Cell => {
      const metadata = { ...(c.metadata ?? {}) };
      const chaky = metadata.chakybricks as { language?: string } | undefined;
      const type: CellType =
        c.cell_type === "markdown" ? "markdown" : chaky?.language === "sql" ? "sql" : "python";
      return {
        id: c.id || newCellId(),
        type,
        source: joinText(c.source),
        outputs: (c.outputs ?? []).map(normalizeOutput),
        executionCount: c.execution_count ?? null,
        status: "idle",
        durationMs: null,
        editing: false,
        clearOnNextOutput: false,
        metadata,
      };
    });
  return {
    cells: cells.length ? cells : [makeCell("python")],
    metadata: notebook.metadata ?? {},
    nbformatMinor: notebook.nbformat_minor ?? 5,
  };
}

export function toIpynb(doc: NotebookDoc): Ipynb {
  return {
    nbformat: 4,
    nbformat_minor: Math.max(5, doc.nbformatMinor),
    metadata: doc.metadata,
    cells: doc.cells.map((cell): IpynbCell => {
      const { chakybricks: _ignored, ...rest } = cell.metadata;
      void _ignored;
      if (cell.type === "markdown") {
        return { cell_type: "markdown", id: cell.id, source: cell.source, metadata: rest };
      }
      return {
        cell_type: "code",
        id: cell.id,
        source: cell.source,
        metadata: cell.type === "sql" ? { ...rest, chakybricks: { language: "sql" } } : rest,
        outputs: cell.outputs,
        execution_count: cell.executionCount,
      };
    }),
  };
}

export function codeToRun(cell: Cell): string | null {
  if (cell.type === "markdown") return null;
  return cell.type === "sql" ? `%%sql\n${cell.source}` : cell.source;
}

export function appendOutput(outputs: Output[], output: Output): Output[] {
  const last = outputs[outputs.length - 1];
  if (
    output.output_type === "stream" &&
    last?.output_type === "stream" &&
    last.name === output.name
  ) {
    return [...outputs.slice(0, -1), { ...last, text: last.text + output.text }];
  }
  return [...outputs, normalizeOutput(output)];
}

export function applyCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const parts = line.split("\r");
      return parts[parts.length - 1] === "" && parts.length > 1
        ? parts[parts.length - 2]
        : parts[parts.length - 1];
    })
    .join("\n");
}

export type NotebookAction =
  | { type: "load"; doc: NotebookDoc }
  | { type: "insert"; index: number; cell: Cell }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; delta: -1 | 1 }
  | { type: "source"; id: string; source: string }
  | { type: "change-type"; id: string; cellType: CellType }
  | { type: "editing"; id: string; editing: boolean }
  | { type: "clear-outputs"; id?: string }
  | { type: "queued"; id: string }
  | { type: "started"; id: string; executionCount: number | null }
  | { type: "output"; id: string; output: Output }
  | { type: "clear-output"; id: string; wait: boolean }
  | { type: "done"; id: string; status: "ok" | "error" | "aborted"; durationMs: number | null }
  | { type: "kernel-reset" };

function updateCell(doc: NotebookDoc, id: string, update: (cell: Cell) => Cell): NotebookDoc {
  return { ...doc, cells: doc.cells.map((c) => (c.id === id ? update(c) : c)) };
}

export function notebookReducer(doc: NotebookDoc, action: NotebookAction): NotebookDoc {
  switch (action.type) {
    case "load":
      return action.doc;
    case "insert": {
      const cells = [...doc.cells];
      cells.splice(Math.max(0, Math.min(action.index, cells.length)), 0, action.cell);
      return { ...doc, cells };
    }
    case "remove": {
      const cells = doc.cells.filter((c) => c.id !== action.id);
      return { ...doc, cells: cells.length ? cells : [makeCell("python")] };
    }
    case "move": {
      const index = doc.cells.findIndex((c) => c.id === action.id);
      const target = index + action.delta;
      if (index < 0 || target < 0 || target >= doc.cells.length) return doc;
      const cells = [...doc.cells];
      [cells[index], cells[target]] = [cells[target], cells[index]];
      return { ...doc, cells };
    }
    case "source":
      return updateCell(doc, action.id, (c) => ({ ...c, source: action.source }));
    case "change-type":
      return updateCell(doc, action.id, (c) => ({
        ...c,
        type: action.cellType,
        outputs: action.cellType === "markdown" ? [] : c.outputs,
        executionCount: action.cellType === "markdown" ? null : c.executionCount,
        editing: action.cellType === "markdown",
      }));
    case "editing":
      return updateCell(doc, action.id, (c) => ({ ...c, editing: action.editing }));
    case "clear-outputs":
      return {
        ...doc,
        cells: doc.cells.map((c) =>
          action.id === undefined || c.id === action.id
            ? { ...c, outputs: [], executionCount: null, durationMs: null, status: "idle" }
            : c,
        ),
      };
    case "queued":
      return updateCell(doc, action.id, (c) => ({
        ...c,
        outputs: [],
        status: "queued",
        durationMs: null,
      }));
    case "started":
      return updateCell(doc, action.id, (c) => ({
        ...c,
        status: "running",
        executionCount: action.executionCount,
      }));
    case "output":
      return updateCell(doc, action.id, (c) => ({
        ...c,
        clearOnNextOutput: false,
        outputs: appendOutput(c.clearOnNextOutput ? [] : c.outputs, action.output),
      }));
    case "clear-output":
      return updateCell(doc, action.id, (c) =>
        action.wait ? { ...c, clearOnNextOutput: true } : { ...c, outputs: [] },
      );
    case "done":
      return updateCell(doc, action.id, (c) => ({
        ...c,
        status: action.status,
        durationMs: action.durationMs,
        clearOnNextOutput: false,
      }));
    case "kernel-reset":
      return {
        ...doc,
        cells: doc.cells.map((c) =>
          c.status === "queued" || c.status === "running" ? { ...c, status: "aborted" } : c,
        ),
      };
  }
}

export interface CellSpec {
  cell_type: "code" | "markdown";
  source: string;
  language?: "sql";
}

export function starterCellSpecs(table: string): CellSpec[] {
  return [
    { cell_type: "markdown", source: `# ${table}` },
    { cell_type: "code", source: `df = cb.table("${table}")\ndf.head(100).collect()` },
    { cell_type: "code", language: "sql", source: `SELECT *\nFROM ${table}\nLIMIT 100` },
  ];
}

export function notebookUrl(name: string): string {
  return `/notebooks/${encodeURIComponent(name)}`;
}

export const ADD_LABELS: { value: CellType; label: string }[] = [
  { value: "python", label: "Code" },
  { value: "sql", label: "SQL" },
  { value: "markdown", label: "Markdown" },
];
