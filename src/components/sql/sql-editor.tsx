import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { modelFor, monaco } from "@/lib/monaco";
import { useTheme } from "@/lib/theme";

export interface SqlEditorHandle {
  insert: (text: string) => void;
  focus: () => void;
  runText: () => string;
}

interface SqlEditorProps {
  tabId: string;
  value: string;
  onChange: (sql: string) => void;
  onRun: (sql: string, all: boolean) => void;
  onSave: () => void;
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { tabId, value, onChange, onRun, onSave },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const callbacks = useRef({ onChange, onRun, onSave });
  const currentTab = useRef(tabId);
  const { theme } = useTheme();

  const initialValue = useRef(value);

  useEffect(() => {
    callbacks.current = { onChange, onRun, onSave };
    initialValue.current = value;
  });

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: "line",
      fixedOverflowWidgets: true,
      tabSize: 2,
      wordBasedSuggestions: "off",
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { showWords: false },
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    editorRef.current = editor;

    const runCurrent = (all: boolean) => {
      const model = editor.getModel();
      if (!model) return;
      const selection = editor.getSelection();
      const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
      callbacks.current.onRun(!all && selected.trim() ? selected : model.getValue(), all);
    };
    editor.addAction({
      id: "chaky.run",
      label: "Run selection or query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => runCurrent(false),
    });
    editor.addAction({
      id: "chaky.run-all",
      label: "Run all",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => runCurrent(true),
    });
    editor.addAction({
      id: "chaky.save",
      label: "Save query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => callbacks.current.onSave(),
    });
    const subscription = editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (model) callbacks.current.onChange(model.getValue());
    });

    return () => {
      subscription.dispose();
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (currentTab.current !== tabId) {
      viewStates.current.set(currentTab.current, editor.saveViewState());
      currentTab.current = tabId;
    }
    const model = modelFor(tabId, initialValue.current);
    if (editor.getModel() !== model) {
      editor.setModel(model);
      const state = viewStates.current.get(tabId);
      if (state) editor.restoreViewState(state);
      editor.focus();
    }
  }, [tabId]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "chaky-dark" : "chaky-light");
  }, [theme]);

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const editor = editorRef.current;
      const selection = editor?.getSelection();
      if (!editor || !selection) return;
      editor.executeEdits("insert", [{ range: selection, text, forceMoveMarkers: true }]);
      editor.focus();
    },
    focus() {
      editorRef.current?.focus();
    },
    runText() {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return "";
      const selection = editor.getSelection();
      const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
      return selected.trim() ? selected : model.getValue();
    },
  }));

  return <div ref={containerRef} className="h-full w-full" />;
});
