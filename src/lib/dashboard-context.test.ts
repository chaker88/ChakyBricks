import { describe, expect, it } from "vitest";
import { ColorAssigner, PALETTE_SIZE, hashSlot } from "@/lib/dashboard-context";

describe("series colours", () => {
  it("derives the slot from the value alone", () => {
    expect(hashSlot("Europe")).toBe(hashSlot("Europe"));
    expect(hashSlot("الفئة")).toBeLessThan(PALETTE_SIZE);
    const slots = new Set(["a", "b", "c", "d", "e", "f"].map((n) => hashSlot(n)));
    expect(slots.size).toBeGreaterThan(1);
  });

  it("gives a value the same colour in every tile when nothing collides", () => {
    const assigner = new ColorAssigner();
    const one = assigner.assign("t1", ["Europe", "MENA"]);
    const two = assigner.assign("t2", ["Europe"]);
    expect(two.get("Europe")).toBe(one.get("Europe"));
  });

  it("separates colliding values independently of arrival order", () => {
    const names = Array.from({ length: 8 }, (_, i) => `series ${i}`);
    const forward = new ColorAssigner().assign("t", names);
    const backward = new ColorAssigner().assign("t", [...names].reverse());
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
    expect(new Set(forward.values()).size).toBe(8);
  });

  it("keeps earlier assignments when a filter changes the set", () => {
    const assigner = new ColorAssigner();
    const before = assigner.assign("t", ["a", "b", "c"]);
    const snapshot = new Map(before);
    const after = assigner.assign("t", ["b", "d"]);
    expect(after.get("b")).toBe(snapshot.get("b"));
  });
});
