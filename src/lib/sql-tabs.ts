export interface SqlTab {
  id: string;
  title: string;
  sql: string;
  savedQueryId: number | null;
  savedSql: string | null;
}

export interface TabsState {
  tabs: SqlTab[];
  activeId: string;
  counter: number;
}

export type TabsAction =
  | { type: "new"; sql?: string; title?: string; id?: string }
  | { type: "close"; id: string }
  | { type: "activate"; id: string }
  | { type: "edit"; id: string; sql: string }
  | { type: "saved"; id: string; savedQueryId: number; title: string; sql: string }
  | { type: "open-saved"; savedQueryId: number; title: string; sql: string; id?: string }
  | { type: "forget-saved"; savedQueryId: number };

export const TABS_STORAGE_KEY = "chakybricks.sql-tabs";

export function newTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function blankTab(counter: number, id = newTabId(), sql = "", title?: string): SqlTab {
  return { id, title: title ?? `Query ${counter}`, sql, savedQueryId: null, savedSql: null };
}

export function initialTabsState(): TabsState {
  const tab = blankTab(1);
  return { tabs: [tab], activeId: tab.id, counter: 1 };
}

export function isDirty(tab: SqlTab): boolean {
  return tab.savedQueryId !== null && tab.sql !== tab.savedSql;
}

export function activeTab(state: TabsState): SqlTab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "new": {
      const counter = state.counter + 1;
      const tab = blankTab(counter, action.id, action.sql ?? "", action.title);
      return { tabs: [...state.tabs, tab], activeId: tab.id, counter };
    }
    case "close": {
      const index = state.tabs.findIndex((t) => t.id === action.id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      if (tabs.length === 0) return initialTabsState();
      const activeId =
        state.activeId === action.id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId;
      return { ...state, tabs, activeId };
    }
    case "activate":
      return state.tabs.some((t) => t.id === action.id) ? { ...state, activeId: action.id } : state;
    case "edit":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, sql: action.sql } : t)),
      };
    case "saved":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id
            ? {
                ...t,
                title: action.title,
                savedQueryId: action.savedQueryId,
                savedSql: action.sql,
                sql: action.sql,
              }
            : t,
        ),
      };
    case "open-saved": {
      const existing = state.tabs.find((t) => t.savedQueryId === action.savedQueryId);
      if (existing) return { ...state, activeId: existing.id };
      const counter = state.counter + 1;
      const tab: SqlTab = {
        id: action.id ?? newTabId(),
        title: action.title,
        sql: action.sql,
        savedQueryId: action.savedQueryId,
        savedSql: action.sql,
      };
      const current = activeTab(state);
      const replaceBlank = state.tabs.length === 1 && !current.sql && current.savedQueryId === null;
      return {
        tabs: replaceBlank ? [tab] : [...state.tabs, tab],
        activeId: tab.id,
        counter,
      };
    }
    case "forget-saved":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.savedQueryId === action.savedQueryId ? { ...t, savedQueryId: null, savedSql: null } : t,
        ),
      };
  }
}

export function loadTabs(): TabsState {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return initialTabsState();
    const parsed = JSON.parse(raw) as TabsState;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return initialTabsState();
    return {
      tabs: parsed.tabs,
      activeId: parsed.tabs.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : parsed.tabs[0].id,
      counter: Number(parsed.counter) || parsed.tabs.length,
    };
  } catch {
    return initialTabsState();
  }
}

export function saveTabs(state: TabsState): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable; tabs last for this session only
  }
}
