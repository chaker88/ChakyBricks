import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { monaco, setPythonCompleter, type KernelCompletion } from "@/lib/monaco";
import type { CellType } from "@/lib/notebook";
import { useTheme } from "@/lib/theme";

export interface CellEditorHandle {
  focus: () => void;
}

export type RunMode = "stay" | "advance" | "insert";

const LANGUAGE: Record<CellType, string> = { python: "python", sql: "sql", markdown: "markdown" };
const MIN_HEIGHT = 38;
const MAX_HEIGHT = 640;

export const CellEditor = forwardRef<
  CellEditorHandle,
  {
    type: CellType;
    value: string;
    autoFocus?: boolean;
    onChange: (source: string) => void;
    onRun: (mode: RunMode) => void;
    onFocus?: () => void;
    complete?: (code: string, offset: number) => Promise<KernelCompletion>;
  }
>(function CellEditor({ type, value, autoFocus, onChange, onRun, onFocus, complete }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const callbacks = useRef({ onChange, onRun, onFocus, complete });
  const initial = useRef({ value, type, autoFocus });
  const { theme } = useTheme();

  useEffect(() => {
    callbacks.current = { onChange, onRun, onFocus, complete };
  });

  useEffect(() => {
    const container = containerRef.current!;
    const model = monaco.editor.createModel(initial.current.value, LANGUAGE[initial.current.type]);
    const editor = monaco.editor.create(container, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      fixedOverflowWidgets: true,
      wordWrap: initial.current.type === "markdown" ? "on" : "off",
      tabSize: 4,
      padding: { top: 8, bottom: 8 },
      wordBasedSuggestions: "off",
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        alwaysConsumeMouseWheel: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    });
    editorRef.current = editor;
    setPythonCompleter(model, (code, offset) =>
      callbacks.current.complete
        ? callbacks.current.complete(code, offset)
        : Promise.resolve({ matches: [], cursorStart: offset, cursorEnd: offset }),
    );

    const resize = () => {
      const height = Math.min(Math.max(editor.getContentHeight(), MIN_HEIGHT), MAX_HEIGHT);
      container.style.height = `${height}px`;
      editor.layout();
    };
    const subscriptions = [
      editor.onDidContentSizeChange(resize),
      editor.onDidChangeModelContent(() => callbacks.current.onChange(model.getValue())),
      editor.onDidFocusEditorText(() => callbacks.current.onFocus?.()),
    ];
    resize();

    const bindings: [string, number, RunMode][] = [
      ["run-advance", monaco.KeyMod.Shift | monaco.KeyCode.Enter, "advance"],
      ["run-stay", monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, "stay"],
      ["run-insert", monaco.KeyMod.Alt | monaco.KeyCode.Enter, "insert"],
    ];
    for (const [id, keybinding, mode] of bindings) {
      editor.addAction({
        id: `chaky.cell.${id}`,
        label: `Run cell (${mode})`,
        keybindings: [keybinding],
        run: () => callbacks.current.onRun(mode),
      });
    }
    if (initial.current.autoFocus) editor.focus();

    return () => {
      subscriptions.forEach((s) => s.dispose());
      setPythonCompleter(model, null);
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, LANGUAGE[type]);
    editorRef.current?.updateOptions({ wordWrap: type === "markdown" ? "on" : "off" });
  }, [type]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "chaky-dark" : "chaky-light");
  }, [theme]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
  }));

  return <div ref={containerRef} className="w-full" style={{ height: MIN_HEIGHT }} />;
});
