import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { leaderAbilityText, parseAttachTargets, isLeaderUnit } from "./leader";

function cat(entries: unknown[]): IrCatalogue {
  return { id: "c", name: "C", gameSystemId: "gs", revision: 1, entries } as unknown as IrCatalogue;
}
function leaderEntry(id: string, name: string, desc: string) {
  return {
    id, name, costs: [], categories: [], constraints: [], children: [], groups: [],
    profiles: [{ name: "Leader", typeName: "Abilities", characteristics: [{ name: "Description", value: desc }] }],
  };
}

describe("parseAttachTargets", () => {
  it("parses ■ bullet lines", () => {
    expect(parseAttachTargets(
      "This unit can be attached to the following units:\n\n■ Assault Intercessor Squad\n■ Intercessor Squad",
    )).toEqual(["Assault Intercessor Squad", "Intercessor Squad"]);
  });
  it("parses ALL-CAPS ■ bullets verbatim (matched case-insensitively later)", () => {
    expect(parseAttachTargets(
      "This model can be attached to the following units:\n\n■ AGGRESSOR SQUAD\n■ ERADICATOR SQUAD",
    )).toEqual(["AGGRESSOR SQUAD", "ERADICATOR SQUAD"]);
  });
  it("parses dash + bold bullets and drops the (Excluding …) clause", () => {
    expect(parseAttachTargets(
      "This model can be attached to the following units:\n- **^^Tactical Squad^^**\n- **^^Tacticus^^** (Excluding ^^**Character^^** and **^^Fly**^^)",
    )).toEqual(["Tactical Squad", "Tacticus"]);
  });
  it("parses inline comma-separated names", () => {
    expect(parseAttachTargets(
      "This model can be attached to the following units: ^^**Seraphim Squad, Zephyrim Squad**^^",
    )).toEqual(["Seraphim Squad", "Zephyrim Squad"]);
  });
  it("returns [] when there is no attach list", () => {
    expect(parseAttachTargets("Some other ability text.")).toEqual([]);
  });
  it("deduplicates repeated names", () => {
    expect(parseAttachTargets(
      "attached to the following units:\n■ Battle Sisters Squad\n■ Battle Sisters Squad",
    )).toEqual(["Battle Sisters Squad"]);
  });
});

describe("leaderAbilityText / isLeaderUnit", () => {
  const c = cat([
    leaderEntry("e.lead", "Canoness", "attached to the following units:\n■ Battle Sisters Squad"),
    { id: "e.plain", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [],
      profiles: [{ name: "Battle Sisters Squad", typeName: "Unit", characteristics: [] }] },
  ]);
  it("returns the Leader ability Description for a leader", () => {
    expect(leaderAbilityText(c, "e.lead")).toContain("Battle Sisters Squad");
  });
  it("returns undefined for a non-leader", () => {
    expect(leaderAbilityText(c, "e.plain")).toBeUndefined();
  });
  it("isLeaderUnit is true only for a leader", () => {
    expect(isLeaderUnit(c, "e.lead")).toBe(true);
    expect(isLeaderUnit(c, "e.plain")).toBe(false);
    expect(isLeaderUnit(c, "e.missing")).toBe(false);
  });
});
