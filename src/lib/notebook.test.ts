import { parseAnsi, stripAnsi } from "@/lib/ansi";
import {
  appendOutput,
  applyCarriageReturns,
  codeToRun,
  fromIpynb,
  makeCell,
  notebookReducer,
  toIpynb,
  type Ipynb,
  type NotebookDoc,
} from "@/lib/notebook";

const ipynb: Ipynb = {
  nbformat: 4,
  nbformat_minor: 4,
  metadata: { kernelspec: { name: "chakybricks" } },
  cells: [
    { cell_type: "markdown", id: "m1", source: ["# Title\n", "text"], metadata: {} },
    {
      cell_type: "code",
      id: "s1",
      source: "SELECT 1",
      metadata: { chakybricks: { language: "sql" } },
      outputs: [],
      execution_count: 2,
    },
    {
      cell_type: "code",
      source: ["x = 1\n", "x"],
      metadata: { tags: ["a"] },
      outputs: [
        { output_type: "stream", name: "stdout", text: ["a\n", "b\n"] as unknown as string },
        {
          output_type: "execute_result",
          data: { "text/plain": ["1"] },
          metadata: {},
          execution_count: 3,
        },
      ],
      execution_count: 3,
    },
    { cell_type: "raw", source: "ignored" },
  ],
};

describe("notebook model", () => {
  it("reads ipynb cells, languages and multiline text", () => {
    const doc = fromIpynb(ipynb);
    expect(doc.cells.map((c) => c.type)).toEqual(["markdown", "sql", "python"]);
    expect(doc.cells[0].source).toBe("# Title\ntext");
    expect(doc.cells[2].source).toBe("x = 1\nx");
    expect(doc.cells[2].outputs[0]).toEqual({
      output_type: "stream",
      name: "stdout",
      text: "a\nb\n",
    });
    expect(doc.cells[2].outputs[1]).toMatchObject({ data: { "text/plain": "1" } });
    expect(doc.cells[2].id).toHaveLength(12);
    expect(fromIpynb({ ...ipynb, cells: [] }).cells).toHaveLength(1);
  });

  it("writes ipynb with ids, sql metadata and nbformat 4.5+", () => {
    const out = toIpynb(fromIpynb(ipynb));
    expect(out.nbformat_minor).toBe(5);
    expect(out.cells[0]).toEqual({
      cell_type: "markdown",
      id: "m1",
      source: "# Title\ntext",
      metadata: {},
    });
    expect(out.cells[1].metadata).toEqual({ chakybricks: { language: "sql" } });
    expect(out.cells[2].metadata).toEqual({ tags: ["a"] });
    expect(out.cells[2].execution_count).toBe(3);
    const switched = notebookReducer(fromIpynb(ipynb), {
      type: "change-type",
      id: "s1",
      cellType: "python",
    });
    expect(toIpynb(switched).cells[1].metadata).toEqual({});
  });

  it("prefixes sql cells with the magic", () => {
    expect(codeToRun(makeCell("sql", "SELECT 1"))).toBe("%%sql\nSELECT 1");
    expect(codeToRun(makeCell("python", "x"))).toBe("x");
    expect(codeToRun(makeCell("markdown", "# t"))).toBeNull();
  });

  it("merges consecutive stream outputs and handles carriage returns", () => {
    let outputs = appendOutput([], { output_type: "stream", name: "stdout", text: "a" });
    outputs = appendOutput(outputs, { output_type: "stream", name: "stdout", text: "b" });
    outputs = appendOutput(outputs, { output_type: "stream", name: "stderr", text: "c" });
    expect(outputs).toEqual([
      { output_type: "stream", name: "stdout", text: "ab" },
      { output_type: "stream", name: "stderr", text: "c" },
    ]);
    expect(applyCarriageReturns("10%\r50%\r100%\ndone")).toBe("100%\ndone");
    expect(applyCarriageReturns("progress\r")).toBe("progress");
  });

  it("tracks execution through kernel events", () => {
    const cell = makeCell("python", "print(1)");
    let doc: NotebookDoc = { cells: [cell], metadata: {}, nbformatMinor: 5 };
    doc = notebookReducer(doc, {
      type: "output",
      id: cell.id,
      output: { output_type: "stream", name: "stdout", text: "old" },
    });
    doc = notebookReducer(doc, { type: "queued", id: cell.id });
    expect(doc.cells[0]).toMatchObject({ status: "queued", outputs: [] });
    doc = notebookReducer(doc, { type: "started", id: cell.id, executionCount: 4 });
    doc = notebookReducer(doc, {
      type: "output",
      id: cell.id,
      output: { output_type: "stream", name: "stdout", text: "1\n" },
    });
    doc = notebookReducer(doc, { type: "clear-output", id: cell.id, wait: true });
    expect(doc.cells[0].outputs).toHaveLength(1);
    doc = notebookReducer(doc, {
      type: "output",
      id: cell.id,
      output: { output_type: "stream", name: "stdout", text: "2\n" },
    });
    expect(doc.cells[0].outputs).toEqual([{ output_type: "stream", name: "stdout", text: "2\n" }]);
    doc = notebookReducer(doc, { type: "done", id: cell.id, status: "ok", durationMs: 12 });
    expect(doc.cells[0]).toMatchObject({ status: "ok", executionCount: 4, durationMs: 12 });
  });

  it("inserts, moves, removes and resets cells", () => {
    const a = makeCell("python", "a");
    const b = makeCell("sql", "b");
    let doc: NotebookDoc = { cells: [a], metadata: {}, nbformatMinor: 5 };
    doc = notebookReducer(doc, { type: "insert", index: 1, cell: b });
    doc = notebookReducer(doc, { type: "move", id: b.id, delta: -1 });
    expect(doc.cells.map((c) => c.source)).toEqual(["b", "a"]);
    expect(notebookReducer(doc, { type: "move", id: b.id, delta: -1 })).toBe(doc);
    doc = notebookReducer(doc, { type: "queued", id: a.id });
    doc = notebookReducer(doc, { type: "kernel-reset" });
    expect(doc.cells[1].status).toBe("aborted");
    doc = notebookReducer(doc, { type: "remove", id: a.id });
    doc = notebookReducer(doc, { type: "remove", id: b.id });
    expect(doc.cells).toHaveLength(1);
    expect(doc.cells[0].type).toBe("python");
  });
});

describe("ansi", () => {
  it("parses colors and bold and strips other escapes", () => {
    const segments = parseAnsi(
      "\x1b[0;31mZeroDivisionError\x1b[0m: \x1b[1mdivision\x1b[22m by zero\x1b[K",
    );
    expect(segments).toEqual([
      { text: "ZeroDivisionError", color: "ansi-red", bold: false },
      { text: ": ", color: null, bold: false },
      { text: "division", color: null, bold: true },
      { text: " by zero", color: null, bold: false },
    ]);
    expect(parseAnsi("\x1b[92mok\x1b[39m")[0].color).toBe("ansi-green");
    expect(stripAnsi("\x1b[38;5;208mx\x1b[0m")).toBe("x");
  });
});
