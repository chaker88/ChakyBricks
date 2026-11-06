import { NAV_ITEMS, isNavItemActive, navItemForShortcut } from "@/lib/nav";

describe("nav", () => {
  it("lists the rail sections in order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Home",
      "Catalog",
      "SQL",
      "Notebooks",
      "Dashboards",
      "Jobs",
      "Settings",
    ]);
  });

  it("maps Ctrl+number shortcuts to sections", () => {
    expect(navItemForShortcut("3")?.path).toBe("/sql");
    expect(navItemForShortcut("9")).toBeUndefined();
  });

  it("matches the active section, treating home as exact", () => {
    const home = NAV_ITEMS[0];
    const sql = NAV_ITEMS[2];
    expect(isNavItemActive(home, "/")).toBe(true);
    expect(isNavItemActive(home, "/sql")).toBe(false);
    expect(isNavItemActive(sql, "/sql/tab-2")).toBe(true);
    expect(isNavItemActive(sql, "/sqlx")).toBe(false);
  });
});
