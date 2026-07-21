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
  it("is false for an entry with no profiles field at all", () => {
    const c2 = cat([
      { id: "e.noprofiles", name: "Bare Entry", costs: [], categories: [], constraints: [], children: [], groups: [] },
    ]);
    expect(isLeaderUnit(c2, "e.noprofiles")).toBe(false);
  });
});

import type { Roster } from "@muster/domain";
import { leaderTargets, attachLeader, detachLeader, attachedLeaders } from "./leader";

const scenario = () => {
  const catalogue = cat([
    leaderEntry("e.canoness", "Canoness", "attached to the following units:\n■ BATTLE SISTERS SQUAD"),
    { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
    { id: "e.other", name: "Repentia Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
  ]);
  const roster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [
      { id: "L", entryId: "e.canoness", count: 1, selections: [] },
      { id: "B", entryId: "e.bss", count: 1, selections: [] },
      { id: "O", entryId: "e.other", count: 1, selections: [] },
    ],
  } as unknown as Roster;
  return { catalogue, roster };
};

describe("leaderTargets", () => {
  it("offers an eligible present unit (case-insensitive), not ineligible ones", () => {
    const { catalogue, roster } = scenario();
    expect(leaderTargets(roster, catalogue, "L")).toEqual([{ bodyguardSelectionId: "B", bodyguardName: "Battle Sisters Squad" }]);
  });
  it("excludes a target already led by another leader", () => {
    const { catalogue, roster } = scenario();
    const led = attachLeader(roster, catalogue, "L", "B");
    // add a second canoness and confirm B is no longer offered to it
    const twoLeaders = { ...led, selections: [...led.selections, { id: "L2", entryId: "e.canoness", count: 1, selections: [] }] } as Roster;
    expect(leaderTargets(twoLeaders, catalogue, "L2")).toEqual([]);
  });
  it("returns [] for a non-leader selection", () => {
    const { catalogue, roster } = scenario();
    expect(leaderTargets(roster, catalogue, "B")).toEqual([]);
  });
  it("returns [] for an unknown selection id", () => {
    const { catalogue, roster } = scenario();
    expect(leaderTargets(roster, catalogue, "zzz")).toEqual([]);
  });
  it("returns [] when the Leader's ability text carries no attach list", () => {
    const catalogue = cat([
      leaderEntry("e.nolist", "Chaplain", "This model has the Leader ability but no attach list."),
      { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
    ]);
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "L", entryId: "e.nolist", count: 1, selections: [] },
        { id: "B", entryId: "e.bss", count: 1, selections: [] },
      ],
    } as unknown as Roster;
    expect(leaderTargets(roster, catalogue, "L")).toEqual([]);
  });
});

describe("attachLeader / detachLeader", () => {
  it("attaches an eligible target and does not mutate the input", () => {
    const { catalogue, roster } = scenario();
    const next = attachLeader(roster, catalogue, "L", "B");
    expect(next.selections.find((s) => s.id === "L")?.attachedTo).toBe("B");
    expect(roster.selections.find((s) => s.id === "L")?.attachedTo).toBeUndefined();
  });
  it("is a no-op for an ineligible target", () => {
    const { catalogue, roster } = scenario();
    expect(attachLeader(roster, catalogue, "L", "O")).toBe(roster);
  });
  it("is a no-op when the target is already led", () => {
    const { catalogue, roster } = scenario();
    const once = attachLeader(roster, catalogue, "L", "B");
    const twoLeaders = { ...once, selections: [...once.selections, { id: "L2", entryId: "e.canoness", count: 1, selections: [] }] } as Roster;
    expect(attachLeader(twoLeaders, catalogue, "L2", "B")).toBe(twoLeaders);
  });
  it("detaches, clearing attachedTo", () => {
    const { catalogue, roster } = scenario();
    const attached = attachLeader(roster, catalogue, "L", "B");
    const detached = detachLeader(attached, "L");
    expect(detached.selections.find((s) => s.id === "L")?.attachedTo).toBeUndefined();
  });
  it("detach is a no-op for an unattached leader", () => {
    const { catalogue, roster } = scenario();
    expect(detachLeader(roster, "L")).toBe(roster);
  });
});

describe("attachedLeaders", () => {
  it("lists the leaders attached to a bodyguard", () => {
    const { catalogue, roster } = scenario();
    const attached = attachLeader(roster, catalogue, "L", "B");
    expect(attachedLeaders(attached, "B").map((s) => s.id)).toEqual(["L"]);
    expect(attachedLeaders(attached, "O")).toEqual([]);
  });
});
