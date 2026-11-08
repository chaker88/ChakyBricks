import { plural } from "@/lib/format";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import type { TableSummary } from "@/lib/api-types";
import { completionsAt, type CompletionKind } from "@/lib/sql-completion";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme("chaky-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "c2410c", fontStyle: "bold" },
    { token: "string", foreground: "15803d" },
    { token: "number", foreground: "1d4ed8" },
    { token: "comment", foreground: "8a8a93", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#fcfcfc",
    "editor.lineHighlightBackground": "#f3f3f5",
    "editorLineNumber.foreground": "#b4b4bb",
    "editorCursor.foreground": "#e2622e",
    "editor.selectionBackground": "#fbd5c3",
  },
});

monaco.editor.defineTheme("chaky-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "fb923c", fontStyle: "bold" },
    { token: "string", foreground: "86efac" },
    { token: "number", foreground: "93c5fd" },
    { token: "comment", foreground: "71717a", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#141416",
    "editor.lineHighlightBackground": "#1c1c20",
    "editorLineNumber.foreground": "#4b4b53",
    "editorCursor.foreground": "#f0773f",
    "editor.selectionBackground": "#7c2d1266",
  },
});

let completionTables: TableSummary[] = [];

export function setCompletionTables(tables: TableSummary[]): void {
  completionTables = tables;
}

const KIND: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  function: monaco.languages.CompletionItemKind.Function,
  schema: monaco.languages.CompletionItemKind.Module,
  table: monaco.languages.CompletionItemKind.Struct,
  column: monaco.languages.CompletionItemKind.Field,
};

monaco.languages.registerCompletionItemProvider("sql", {
  triggerCharacters: ["."],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const before = model.getValueInRange(
      new monaco.Range(1, 1, position.lineNumber, position.column),
    );
    const suggestions = completionsAt(before, model.getValue(), completionTables).map((item) => ({
      label: item.label,
      kind: KIND[item.kind],
      insertText: item.insertText,
      detail: item.detail,
      sortText: item.sortText,
      range,
    }));
    return { suggestions };
  },
});

const models = new Map<string, monaco.editor.ITextModel>();

export function modelFor(tabId: string, value: string): monaco.editor.ITextModel {
  let model = models.get(tabId);
  if (!model || model.isDisposed()) {
    model = monaco.editor.createModel(value, "sql");
    models.set(tabId, model);
  }
  return model;
}

export function disposeModel(tabId: string): void {
  models.get(tabId)?.dispose();
  models.delete(tabId);
}

export { monaco };

export interface KernelCompletion {
  matches: string[];
  cursorStart: number;
  cursorEnd: number;
}

type PythonCompleter = (code: string, offset: number) => Promise<KernelCompletion>;

const pythonCompleters = new Map<string, PythonCompleter>();
const TABLE_ARGUMENT = /cb\.(?:table\(\s*|save\([^()]*,\s*)["']([^"']*)$/;

export function setPythonCompleter(
  model: monaco.editor.ITextModel,
  completer: PythonCompleter | null,
): void {
  if (completer) pythonCompleters.set(model.uri.toString(), completer);
  else pythonCompleters.delete(model.uri.toString());
}

monaco.languages.registerCompletionItemProvider("python", {
  triggerCharacters: [".", '"', "'"],
  async provideCompletionItems(model, position) {
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const tableArgument = TABLE_ARGUMENT.exec(line);
    if (tableArgument) {
      const typed = tableArgument[1];
      const range = new monaco.Range(
        position.lineNumber,
        position.column - typed.length,
        position.lineNumber,
        position.column,
      );
      return {
        suggestions: completionTables.map((t) => {
          const name = t.schema === "main" ? t.name : `${t.schema}.${t.name}`;
          return {
            label: name,
            kind: monaco.languages.CompletionItemKind.Struct,
            insertText: name,
            detail: plural(t.row_count, "row"),
            range,
          };
        }),
      };
    }
    const completer = pythonCompleters.get(model.uri.toString());
    if (!completer) return { suggestions: [] };
    const offset = model.getOffsetAt(position);
    const reply = await completer(model.getValue(), offset);
    const start = model.getPositionAt(reply.cursorStart);
    const end = model.getPositionAt(reply.cursorEnd);
    const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    return {
      suggestions: reply.matches.slice(0, 200).map((match, index) => ({
        label: match,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: match,
        sortText: String(index).padStart(4, "0"),
        range,
      })),
    };
  },
});
