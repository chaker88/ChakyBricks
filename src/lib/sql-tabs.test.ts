import {
  TABS_STORAGE_KEY,
  activeTab,
  initialTabsState,
  isDirty,
  loadTabs,
  saveTabs,
  tabsReducer,
  type TabsState,
} from "@/lib/sql-tabs";

describe("sql tabs", () => {
  it("creates, edits, activates and closes tabs", () => {
    let state = initialTabsState();
    const first = state.activeId;
    state = tabsReducer(state, { type: "new", sql: "SELECT 1", id: "b" });
    expect(state.tabs.map((t) => t.title)).toEqual(["Query 1", "Query 2"]);
    expect(state.activeId).toBe("b");
    state = tabsReducer(state, { type: "edit", id: "b", sql: "SELECT 2" });
    expect(activeTab(state).sql).toBe("SELECT 2");
    state = tabsReducer(state, { type: "activate", id: first });
    expect(state.activeId).toBe(first);
    state = tabsReducer(state, { type: "close", id: first });
    expect(state.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(state.activeId).toBe("b");
    state = tabsReducer(state, { type: "close", id: "b" });
    expect(state.tabs).toHaveLength(1);
    expect(activeTab(state).sql).toBe("");
  });

  it("tracks saved queries and dirty state", () => {
    let state = initialTabsState();
    const id = state.activeId;
    state = tabsReducer(state, { type: "edit", id, sql: "SELECT 1" });
    expect(isDirty(activeTab(state))).toBe(false);
    state = tabsReducer(state, {
      type: "saved",
      id,
      savedQueryId: 7,
      title: "Revenue",
      sql: "SELECT 1",
    });
    expect(activeTab(state).title).toBe("Revenue");
    state = tabsReducer(state, { type: "edit", id, sql: "SELECT 2" });
    expect(isDirty(activeTab(state))).toBe(true);
    state = tabsReducer(state, { type: "forget-saved", savedQueryId: 7 });
    expect(activeTab(state).savedQueryId).toBeNull();
  });

  it("opens saved queries once, replacing a single blank tab", () => {
    let state = initialTabsState();
    state = tabsReducer(state, {
      type: "open-saved",
      savedQueryId: 3,
      title: "A",
      sql: "SELECT 3",
      id: "s",
    });
    expect(state.tabs.map((t) => t.id)).toEqual(["s"]);
    state = tabsReducer(state, { type: "new" });
    state = tabsReducer(state, {
      type: "open-saved",
      savedQueryId: 3,
      title: "A",
      sql: "SELECT 3",
    });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe("s");
  });

  it("persists to localStorage and recovers from bad data", () => {
    const state: TabsState = tabsReducer(initialTabsState(), {
      type: "new",
      sql: "SELECT 9",
      id: "z",
    });
    saveTabs(state);
    expect(loadTabs()).toEqual(state);
    localStorage.setItem(TABS_STORAGE_KEY, "{not json");
    expect(loadTabs().tabs).toHaveLength(1);
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs: [], activeId: "x" }));
    expect(loadTabs().tabs).toHaveLength(1);
  });
});
