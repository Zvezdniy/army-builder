import { describe, it, expect, vi } from "vitest";
import type { IrCatalogue, IrCharacteristicModifier, IrCondition, IrEntry, Roster, RosterSelection } from "@muster/domain";
import { effectiveDatasheet } from "@muster/engine-eval";

const entry = (over: Partial<IrEntry> & { id: string; name: string }): IrEntry => ({
  costs: [],
  categories: [],
  constraints: [],
  children: [],
  ...over,
});

const sel = (entryId: string, children: RosterSelection[] = []): RosterSelection => ({
  id: `sel.${entryId}.${Math.random().toString(36).slice(2)}`,
  entryId,
  count: 1,
  selections: children,
});

function catalogue(entries: IrEntry[]): IrCatalogue {
  return { id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], entries } as IrCatalogue;
}

function roster(selections: RosterSelection[]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1,
    pointsLimit: 2000, selections,
  };
}

const charMod = (over: Partial<IrCharacteristicModifier>): IrCharacteristicModifier => ({
  characteristic: "Sv",
  profileType: "Unit",
  kind: "set",
  value: "2+",
  targetScope: "self",
  recursive: false,
  ...over,
});

describe("effectiveDatasheet", () => {
  it("set swaps a Unit characteristic", () => {
    const cat = catalogue([
      entry({
        id: "e.hero", name: "Hero", type: "unit",
        profiles: [{ name: "Hero", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
        characteristicModifiers: [charMod({ characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.hero")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const unitSection = out.find((s) => s.typeName === "Unit");
    expect(unitSection?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "2+" }]);
  });

  it("increment on a weapon characteristic reformats the value keeping its suffix", () => {
    const cat = catalogue([
      entry({
        id: "e.gun", name: "Gun", type: "unit",
        profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '10"' }] }],
        characteristicModifiers: [charMod({ characteristic: "R", profileType: "Ranged Weapons", kind: "increment", value: "2", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.gun")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const weapons = out.find((s) => s.typeName === "Ranged Weapons");
    expect(weapons?.profiles[0]?.characteristics).toEqual([{ name: "R", value: '12"' }]);
  });

  it("decrement on a characteristic subtracts and keeps the suffix", () => {
    const cat = catalogue([
      entry({
        id: "e.gun", name: "Gun", type: "unit",
        profiles: [{ name: "Cannon", typeName: "Ranged Weapons", characteristics: [{ name: "S", value: "8" }] }],
        characteristicModifiers: [charMod({ characteristic: "S", profileType: "Ranged Weapons", kind: "decrement", value: "1", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.gun")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const weapons = out.find((s) => s.typeName === "Ranged Weapons");
    expect(weapons?.profiles[0]?.characteristics).toEqual([{ name: "S", value: "7" }]);
  });

  it("a condition-gated modifier applies only when its gate passes", () => {
    const condition: IrCondition = {
      id: "cond.warlord", comparator: "atLeast", value: 1, field: "selections",
      scope: "parent", targetType: "entry", targetId: "e.warlord", includeChildSelections: false,
    };
    const cat = catalogue([
      entry({
        id: "e.model", name: "Model", type: "model",
        profiles: [{ name: "Model", typeName: "Unit", characteristics: [{ name: "T", value: "4" }] }],
        children: [
          entry({
            id: "e.relic", name: "Relic", type: "upgrade",
            characteristicModifiers: [charMod({
              characteristic: "T", profileType: "Unit", kind: "increment", value: "1",
              targetScope: "parent", recursive: false, conditions: [condition],
            })],
          }),
          entry({ id: "e.warlord", name: "Warlord Trait", type: "upgrade" }),
        ],
      }),
    ]);

    const withWarlord = roster([sel("e.model", [sel("e.relic"), sel("e.warlord")])]);
    const withoutWarlord = roster([sel("e.model", [sel("e.relic")])]);

    const passed = effectiveDatasheet(cat, withWarlord, withWarlord.selections[0]!.id);
    const failed = effectiveDatasheet(cat, withoutWarlord, withoutWarlord.selections[0]!.id);

    expect(passed.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "T", value: "5" }]);
    expect(failed.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "T", value: "4" }]);
  });

  it("a cross-entry modifier (owning upgrade -> parent model's Unit profile) reaches its target", () => {
    const cat = catalogue([
      entry({
        id: "e.model", name: "Model", type: "model",
        profiles: [{ name: "Model", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
        children: [
          entry({
            id: "e.armour", name: "Artificer Armour", type: "upgrade",
            characteristicModifiers: [charMod({
              characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+",
              targetScope: "model", recursive: true,
            })],
          }),
        ],
      }),
    ]);
    const r = roster([sel("e.model", [sel("e.armour")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    expect(out.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "2+" }]);
  });

  it("a non-numeric target value is left unchanged and a diagnostic is logged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cat = catalogue([
      entry({
        id: "e.gun", name: "Gun", type: "unit",
        profiles: [{ name: "Plasma", typeName: "Ranged Weapons", characteristics: [{ name: "D", value: "D6" }] }],
        characteristicModifiers: [charMod({ characteristic: "D", profileType: "Ranged Weapons", kind: "increment", value: "1", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.gun")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    expect(out.find((s) => s.typeName === "Ranged Weapons")?.profiles[0]?.characteristics).toEqual([{ name: "D", value: "D6" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a recursive broadcast hits every matching profile in the subtree", () => {
    const cat = catalogue([
      entry({
        id: "e.squad", name: "Squad", type: "unit",
        characteristicModifiers: [charMod({
          characteristic: "R", profileType: "Ranged Weapons", kind: "increment", value: "2",
          targetScope: "self", recursive: true,
        })],
        children: [
          entry({ id: "e.trooperA", name: "Trooper A", type: "model",
            profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }] }),
          entry({ id: "e.trooperB", name: "Trooper B", type: "model",
            profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }] }),
        ],
      }),
    ]);
    const r = roster([sel("e.squad", [sel("e.trooperA"), sel("e.trooperB")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const weapons = out.find((s) => s.typeName === "Ranged Weapons");
    // Both troopers' Bolter still dedupe to one row post-modification (both moved to 26").
    expect(weapons?.profiles).toEqual([{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '26"' }] }]);
  });

  it("dedup runs AFTER modifiers: two originally-identical profiles that diverge stay two rows", () => {
    const cat = catalogue([
      entry({
        id: "e.squad", name: "Squad", type: "unit",
        children: [
          entry({
            id: "e.trooperA", name: "Trooper A", type: "model",
            profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }],
            characteristicModifiers: [charMod({
              characteristic: "R", profileType: "Ranged Weapons", kind: "increment", value: "2",
              targetScope: "self", recursive: false,
            })],
          }),
          entry({ id: "e.trooperB", name: "Trooper B", type: "model",
            profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }] }),
        ],
      }),
    ]);
    const r = roster([sel("e.squad", [sel("e.trooperA"), sel("e.trooperB")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const weapons = out.find((s) => s.typeName === "Ranged Weapons");
    expect(weapons?.profiles.map((p) => p.characteristics[0]?.value)).toEqual(['26"', '24"']);
  });

  it("a unit with NO characteristic modifiers returns values identical to the base datasheet grouping", () => {
    const cat = catalogue([
      entry({
        id: "e.hero", name: "Hero", type: "unit",
        profiles: [
          { name: "Hero", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] },
          { name: "Aura", typeName: "Abilities", characteristics: [{ name: "Description", value: "buff" }] },
        ],
        children: [
          entry({ id: "e.sword", name: "Sword", type: "upgrade",
            profiles: [{ name: "Sword", typeName: "Melee Weapons", characteristics: [{ name: "A", value: "5" }] }] }),
        ],
      }),
    ]);
    const r = roster([sel("e.hero", [sel("e.sword")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    expect(out).toEqual([
      { typeName: "Unit", profiles: [{ name: "Hero", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] }] },
      { typeName: "Abilities", profiles: [{ name: "Aura", typeName: "Abilities", characteristics: [{ name: "Description", value: "buff" }] }] },
      { typeName: "Melee Weapons", profiles: [{ name: "Sword", typeName: "Melee Weapons", characteristics: [{ name: "A", value: "5" }] }] },
    ]);
  });

  it("an unparseable increment/decrement magnitude on the modifier itself is left unchanged and diagnosed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cat = catalogue([
      entry({
        id: "e.gun", name: "Gun", type: "unit",
        profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }],
        characteristicModifiers: [charMod({ characteristic: "R", profileType: "Ranged Weapons", kind: "increment", value: "a-lot", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.gun")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    expect(out.find((s) => s.typeName === "Ranged Weapons")?.profiles[0]?.characteristics).toEqual([{ name: "R", value: '24"' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("targetId as an entry id restricts a broadcast to one specific descendant entry", () => {
    const cat = catalogue([
      entry({
        id: "e.squad", name: "Squad", type: "unit",
        characteristicModifiers: [charMod({
          characteristic: "R", profileType: "Ranged Weapons", kind: "increment", value: "2",
          targetScope: "self", recursive: true, targetId: "e.trooperA",
        })],
        children: [
          entry({ id: "e.trooperA", name: "Trooper A", type: "model",
            profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }] }),
          entry({ id: "e.trooperB", name: "Trooper B", type: "model",
            profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }] }),
        ],
      }),
    ]);
    const r = roster([sel("e.squad", [sel("e.trooperA"), sel("e.trooperB")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const weapons = out.find((s) => s.typeName === "Ranged Weapons");
    expect(weapons?.profiles.map((p) => p.characteristics[0]?.value)).toEqual(['26"', '24"']);
  });

  it("targetId as a CATEGORY id (the real-data shape) applies to a node carrying that category", () => {
    const cat = catalogue([
      entry({
        id: "e.squad", name: "Squad", type: "unit",
        characteristicModifiers: [charMod({
          characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+",
          targetScope: "self", recursive: true, targetId: "cat.character",
        })],
        children: [
          entry({
            id: "e.leader", name: "Leader", type: "model", categories: ["cat.character"],
            profiles: [{ name: "Leader", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
          }),
          entry({
            id: "e.trooper", name: "Trooper", type: "model", categories: [],
            profiles: [{ name: "Trooper", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
          }),
        ],
      }),
    ]);
    const r = roster([sel("e.squad", [sel("e.leader"), sel("e.trooper")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const unit = out.find((s) => s.typeName === "Unit");
    expect(unit?.profiles.map((p) => p.characteristics[0]?.value)).toEqual(["2+", "3+"]);
  });

  it("targetId as a CATEGORY id does NOT apply to a node lacking that category", () => {
    const cat = catalogue([
      entry({
        id: "e.squad", name: "Squad", type: "unit",
        characteristicModifiers: [charMod({
          characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+",
          targetScope: "self", recursive: true, targetId: "cat.character",
        })],
        children: [
          entry({
            id: "e.trooper", name: "Trooper", type: "model", categories: [],
            profiles: [{ name: "Trooper", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
          }),
        ],
      }),
    ]);
    const r = roster([sel("e.squad", [sel("e.trooper")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const unit = out.find((s) => s.typeName === "Unit");
    expect(unit?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "3+" }]);
  });

  it("a modifier resolving outside the datasheet's own subtree (roster scope) is silently skipped", () => {
    const cat = catalogue([
      entry({
        id: "e.hero", name: "Hero", type: "unit",
        profiles: [{ name: "Hero", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
        characteristicModifiers: [charMod({
          characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+",
          targetScope: "roster", recursive: true,
        })],
      }),
      entry({
        id: "e.other", name: "Other", type: "unit",
        profiles: [{ name: "Other", typeName: "Unit", characteristics: [{ name: "Sv", value: "5+" }] }],
      }),
    ]);
    // A second, unrelated top-level selection so the roster-scoped modifier's
    // anchor set includes a node OUTSIDE the "e.hero" subtree we're rendering.
    const r = roster([sel("e.hero"), sel("e.other")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    // The modifier is declared on e.hero, whose own Unit profile IS in-subtree,
    // so it still applies there — this test only proves the out-of-subtree
    // "e.other" node (also matched by roster scope) is safely ignored, not
    // that roster scope is inert.
    expect(out.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "2+" }]);
  });

  it("a matching profile without the named characteristic is left untouched", () => {
    const cat = catalogue([
      entry({
        id: "e.gun", name: "Gun", type: "unit",
        profiles: [{ name: "Bolter", typeName: "Ranged Weapons", characteristics: [{ name: "R", value: '24"' }] }],
        characteristicModifiers: [charMod({ characteristic: "AP", profileType: "Ranged Weapons", kind: "increment", value: "1", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.gun")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    expect(out.find((s) => s.typeName === "Ranged Weapons")?.profiles[0]?.characteristics).toEqual([{ name: "R", value: '24"' }]);
  });

  it("a targeted node with multiple profiles only patches the matching typeName", () => {
    const cat = catalogue([
      entry({
        id: "e.model", name: "Model", type: "unit",
        profiles: [
          { name: "Model", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] },
          { name: "Ability", typeName: "Abilities", characteristics: [{ name: "Sv", value: "n/a" }] },
        ],
        characteristicModifiers: [charMod({ characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+", targetScope: "self", recursive: false })],
      }),
    ]);
    const r = roster([sel("e.model")]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    expect(out.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "2+" }]);
    expect(out.find((s) => s.typeName === "Abilities")?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "n/a" }]);
  });

  it("throws for an unknown selectionId", () => {
    const cat = catalogue([entry({ id: "e.hero", name: "Hero", type: "unit" })]);
    const r = roster([sel("e.hero")]);
    expect(() => effectiveDatasheet(cat, r, "not-a-real-id")).toThrow(/Unknown selectionId/);
  });

  // Fix 2 (final review): effectiveDatasheet must resolveCategories(state) —
  // targetId is overwhelmingly a CATEGORY id in real data, so a conditionally
  // ADDED category must be visible to the target filter (and the modifier's
  // own condition gates must see the same resolved membership evaluate() does
  // for the same roster). Mirrors the pattern in
  // packages/engine-eval/test/categories.test.ts.
  it("targetId as a category applies only once resolveCategories resolves a conditionally-added category", () => {
    const cat = catalogue([
      entry({
        id: "e.squad", name: "Squad", type: "unit",
        characteristicModifiers: [charMod({
          characteristic: "Sv", profileType: "Unit", kind: "set", value: "2+",
          targetScope: "self", recursive: true, targetId: "cat.elite",
        })],
        children: [
          entry({
            id: "e.trooper", name: "Trooper", type: "model", categories: [],
            categoryModifiers: [{
              type: "add", categoryId: "cat.elite",
              conditions: [{
                id: "cond.leader", comparator: "atLeast", value: 1, field: "selections",
                scope: "roster", targetType: "entry", targetId: "e.leader", includeChildSelections: true,
              }],
            }],
            profiles: [{ name: "Trooper", typeName: "Unit", characteristics: [{ name: "Sv", value: "3+" }] }],
          }),
          entry({ id: "e.leader", name: "Leader", type: "model" }),
        ],
      }),
    ]);
    const withLeader = roster([sel("e.squad", [sel("e.trooper"), sel("e.leader")])]);
    const withoutLeader = roster([sel("e.squad", [sel("e.trooper")])]);

    const applied = effectiveDatasheet(cat, withLeader, withLeader.selections[0]!.id);
    const notApplied = effectiveDatasheet(cat, withoutLeader, withoutLeader.selections[0]!.id);

    expect(applied.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "2+" }]);
    expect(notApplied.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "Sv", value: "3+" }]);
  });

  // Fix 3 (final review): targetScope "self" + recursive:false must reach the
  // owner's DIRECT CHILDREN, not just the owner itself — real 11e BSData proof
  // (Necrons "Catacomb Command Barge"/"Overlord with Translocation Shroud"):
  // an increment on the Ranged/Melee Weapons S characteristic, scope omitted
  // (-> self via Fix 1's fallback), affects="self.entries.profiles.Ranged
  // Weapons" (non-recursive). The owning model has NO Ranged Weapons profile
  // of its own — only its direct-child weapon entries do.
  it("self scope non-recursive reaches direct children when the owner itself has no matching profile", () => {
    const cat = catalogue([
      entry({
        id: "e.model", name: "Barge", type: "model",
        profiles: [{ name: "Barge", typeName: "Unit", characteristics: [{ name: "T", value: "8" }] }],
        characteristicModifiers: [charMod({
          characteristic: "S", profileType: "Ranged Weapons", kind: "increment", value: "2",
          targetScope: "self", recursive: false,
        })],
        children: [
          entry({
            id: "e.gun", name: "Gauss Cannon", type: "upgrade",
            profiles: [{ name: "Gauss Cannon", typeName: "Ranged Weapons", characteristics: [{ name: "S", value: "5" }] }],
          }),
        ],
      }),
    ]);
    const r = roster([sel("e.model", [sel("e.gun")])]);

    const out = effectiveDatasheet(cat, r, r.selections[0]!.id);

    const weapons = out.find((s) => s.typeName === "Ranged Weapons");
    expect(weapons?.profiles[0]?.characteristics).toEqual([{ name: "S", value: "7" }]);
    // the owner's own Unit profile (which has no Ranged Weapons profile) stays untouched.
    expect(out.find((s) => s.typeName === "Unit")?.profiles[0]?.characteristics).toEqual([{ name: "T", value: "8" }]);
  });
});
