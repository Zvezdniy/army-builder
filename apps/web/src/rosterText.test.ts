import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
import { buildState, resolveCosts, totalCost } from "@muster/engine-eval";
import { rosterToText, rosterToTournamentText } from "./rosterText";

const unitProfile = [{ name: "Body", typeName: "Unit", characteristics: [] }];

// A small synthetic catalogue exercising every line the format needs: a
// detachment, two roles (Character before Battleline per ROLE_ORDER), a
// multi-model unit with a shared wargear item + one model carrying an extra
// item, and a Character with its own wargear that will be attached as a leader.
const catalogue: IrCatalogue = {
  id: "cat", name: "Space Wolves", gameSystemId: "gs", revision: 1, forceConstraints: [],
  categoryNames: { "cat.character": "Character", "cat.battleline": "Battleline" },
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [{ id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"],
        constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" }, { id: "gc.max", type: "max", value: 1, scope: "self" }],
      }],
    },
    {
      id: "e.wolflord", name: "Wolf Lord", costs: [{ name: "points", value: 100 }],
      categories: ["cat.character"], constraints: [], profiles: unitProfile,
      children: [{ id: "e.stormshield", name: "Storm Shield", costs: [], categories: [], constraints: [], children: [] }],
    },
    // A second, NOT-attached Character — proves role ordering independent of the
    // attached Wolf Lord below (which is excluded from its own Character bucket).
    { id: "e.chaplain", name: "Chaplain", costs: [{ name: "points", value: 75 }], categories: ["cat.character"], constraints: [], children: [], profiles: unitProfile },
    {
      id: "e.squad", name: "Grey Hunters", costs: [], categories: ["cat.battleline"], constraints: [], children: [],
    },
    { id: "e.trooper", name: "Grey Hunter", costs: [{ name: "points", value: 20 }], categories: [], constraints: [], children: [], profiles: unitProfile },
    { id: "e.bolter", name: "Bolter", costs: [], categories: [], constraints: [], children: [] },
    { id: "e.powerfist", name: "Power Fist", costs: [{ name: "points", value: 10 }], categories: [], constraints: [], children: [] },
  ],
};

function trooper(id: string, extra: { id: string; entryId: string; count: number; selections: [] }[] = []) {
  return { id, entryId: "e.trooper", count: 1, selections: [{ id: `${id}.bolter`, entryId: "e.bolter", count: 1, selections: [] }, ...extra] };
}

function buildRoster(): Roster {
  let r = createRoster(catalogue, 2000, "Test Army");
  r = toggleDetachment(r, "e.gladius", catalogue);
  const squad = {
    id: "squad", entryId: "e.squad", count: 1,
    selections: [
      trooper("t1"),
      trooper("t2"),
      trooper("t3"),
      trooper("t4", [{ id: "t4.pf", entryId: "e.powerfist", count: 1, selections: [] }]), // sergeant
    ],
  };
  const wolflord = {
    id: "leader", entryId: "e.wolflord", count: 1,
    selections: [{ id: "leader.ss", entryId: "e.stormshield", count: 1, selections: [] }],
    attachedTo: "squad",
  };
  const chaplain = { id: "chaplain", entryId: "e.chaplain", count: 1, selections: [] };
  return { ...r, selections: [...r.selections, squad, wolflord, chaplain] };
}

describe("rosterToText", () => {
  const roster = buildRoster();
  const text = rosterToText(roster, catalogue, { pointsLimit: 2000 });
  const lines = text.split("\n");

  it("header: name, total points, faction, detachment", () => {
    // 4 troopers * 20 + 1 power fist * 10 + chaplain 75 + wolf lord 100 = 265
    expect(lines[0]).toBe("Test Army (265 Points)");
    expect(lines[1]).toBe("Space Wolves");
    expect(lines[2]).toBe("Gladius Task Force");
    expect(lines[3]).toBe(""); // blank line before first role
  });

  it("role headers appear in ROLE_ORDER (Character before Battleline)", () => {
    expect(lines.indexOf("CHARACTER")).toBeGreaterThan(-1);
    expect(lines.indexOf("BATTLELINE")).toBeGreaterThan(-1);
    expect(lines.indexOf("CHARACTER")).toBeLessThan(lines.indexOf("BATTLELINE"));
  });

  it("a >1-model unit gets the Nx prefix; a 1-model (Character) unit does not", () => {
    expect(text).toContain("4x Grey Hunters (90 Points)");
    expect(text).not.toContain("1x Chaplain");
    expect(text).toContain("Chaplain (75 Points)");
  });

  it("wargear bullets use two-space indent and dedupe repeated items", () => {
    expect(text).toContain("  • Bolter");
    expect(text).toContain("  • Power Fist");
    // 4 troopers share one Bolter entry — the loadout summary lists it once.
    expect(text.match(/• Bolter/g)).toHaveLength(1);
  });

  it("an attached leader nests under its host with ↳ and a deeper bullet indent", () => {
    const idx = lines.findIndex((l) => l.includes("↳ Wolf Lord"));
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx]).toBe("  ↳ Wolf Lord (100 Points)");
    expect(lines[idx + 1]).toBe("    • Storm Shield");
    // The leader must NOT also appear as its own top-level Character entry.
    expect(text).not.toMatch(/^Wolf Lord \(100 Points\)$/m);
  });

  it("footer: Total line and signature", () => {
    expect(text).toContain("Total: 265/2000 Points");
    expect(text.trim().endsWith("Exported from Muster")).toBe(true);
  });

  it("invariant: summed per-unit (+ leader) points equal evaluate()'s total", () => {
    const state = buildState(roster, catalogue);
    const { costOf } = resolveCosts(state);
    const total = totalCost(state, costOf);
    // Extract every "(<n> Points)" figure from unit/leader lines (excludes the header
    // and Total lines, which use different wording) and sum them.
    const perUnit = [...text.matchAll(/\((\d+) Points\)/g)]
      .map((m) => Number(m[1]))
      .slice(1); // drop the header line's total (first match)
    expect(perUnit.reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(265);
  });

  it("a role with only an attached (non-root-visible) unit is omitted; empty roster renders header+footer only", () => {
    const empty = createRoster(catalogue, 1500, "Empty");
    const out = rosterToText(empty, catalogue, { pointsLimit: 1500 });
    expect(out).toBe(["Empty (0 Points)", "Space Wolves", "", "Total: 0/1500 Points", "Exported from Muster"].join("\n"));
  });
});

describe("rosterToTournamentText", () => {
  const roster = buildRoster();
  const text = rosterToTournamentText(roster, catalogue, { pointsLimit: 2000 });
  const lines = text.split("\n");

  it("opens with the roster name + total, then a WTC summary block", () => {
    expect(lines[0]).toBe("Test Army (265 Points)");
    expect(lines[1]).toBe(""); // blank line between the name header and the summary block
    expect(lines[2]).toBe("+".repeat(50));
  });

  it("summary lists faction, detachment, total points, warlord and unit count", () => {
    expect(text).toContain("+ FACTION: Space Wolves");
    expect(text).toContain("+ DETACHMENT: Gladius Task Force");
    expect(text).toContain("+ TOTAL ARMY POINTS: 265pts");
    // No explicit Warlord in the model → first Character (the attached Wolf Lord) is derived.
    expect(text).toContain("+ WARLORD: Wolf Lord");
    // 3 datasheets: the squad, its attached Wolf Lord, and the Chaplain (detachment root excluded).
    expect(text).toContain("+ NUMBER OF UNITS: 3");
  });

  it("has no ENHANCEMENT line when the roster takes none", () => {
    expect(text).not.toContain("+ ENHANCEMENT:");
  });

  it("carries the same role-grouped body as the detailed format", () => {
    expect(text).toContain("CHARACTER");
    expect(text).toContain("4x Grey Hunters (90 Points)");
    expect(text).toContain("  ↳ Wolf Lord (100 Points)");
    expect(text.trim().endsWith("Exported from Muster")).toBe(true);
    expect(text).toContain("Total: 265/2000 Points");
  });

  it("falls back to a — Warlord line when the roster has no character", () => {
    // Battleline squad only — no Epic Hero / Character / HQ to derive a warlord from.
    let r = createRoster(catalogue, 2000, "Grunts");
    r = toggleDetachment(r, "e.gladius", catalogue);
    r = { ...r, selections: [...r.selections, { id: "sq", entryId: "e.squad", count: 1, selections: [] }] };
    expect(rosterToTournamentText(r, catalogue, { pointsLimit: 2000 })).toContain("+ WARLORD: —");
  });
});

describe("rosterToTournamentText enhancements", () => {
  // A `set hidden` gate keyed on the chosen detachment is how the parser marks a
  // per-detachment enhancement; enhancementsForDetachment reads exactly that gate.
  const selGate = (detId: string) => ({
    set: true,
    conditionGroups: [{
      type: "and" as const,
      conditions: [{
        id: `cond.${detId}`, comparator: "lessThan" as const, value: 1,
        field: "selections" as const, scope: "roster", targetType: "entry" as const,
        targetId: detId, includeChildSelections: true,
      }],
    }],
  });
  const enhCat = {
    id: "c", name: "Space Wolves", gameSystemId: "gs", revision: 1, forceConstraints: [],
    categoryNames: { "cat.character": "Character" },
    entries: [
      {
        id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
        children: [{ id: "e.gladius", name: "Gladius", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
        groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"], constraints: [{ id: "gc", type: "max", value: 1, scope: "self" }] }],
      },
      {
        id: "e.lord", name: "Wolf Lord", type: "unit", costs: [{ name: "points", value: 100 }],
        categories: ["cat.character"], constraints: [], profiles: [{ name: "Body", typeName: "Unit", characteristics: [] }],
        children: [{ id: "e.relic", name: "Wolf Tooth", type: "upgrade", costs: [{ name: "points", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.gladius")] }],
      },
    ],
  } as unknown as IrCatalogue;

  it("emits one ENHANCEMENT line per enhancement taken, attributed to its host unit", () => {
    let r = createRoster(enhCat, 2000, "SW");
    r = toggleDetachment(r, "e.gladius", enhCat);
    r = { ...r, selections: [...r.selections, {
      id: "lord", entryId: "e.lord", count: 1,
      selections: [{ id: "relic", entryId: "e.relic", count: 1, selections: [] }],
    }] };
    const out = rosterToTournamentText(r, enhCat, { pointsLimit: 2000 });
    expect(out).toContain("+ ENHANCEMENT: Wolf Tooth (on Wolf Lord)");
    expect(out).toContain("+ WARLORD: Wolf Lord");
  });
});
