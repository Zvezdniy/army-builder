import { describe, it, expect } from "vitest";
import { RosterSelection } from "./roster";

describe("RosterSelection.attachedTo", () => {
  it("accepts an optional attachedTo", () => {
    const s = RosterSelection.parse({ id: "l", entryId: "e", count: 1, attachedTo: "b" });
    expect(s.attachedTo).toBe("b");
  });
  it("stays optional (absent when not given)", () => {
    const s = RosterSelection.parse({ id: "l", entryId: "e", count: 1 });
    expect(s.attachedTo).toBeUndefined();
  });
});
