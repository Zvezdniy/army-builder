import { describe, it, expect } from "vitest";
import { IrCharacteristicModifier, IrEntry } from "@muster/domain";

describe("IrCharacteristicModifier", () => {
  it("parses an unconditional cross-entry set modifier (Artificer Armour shape)", () => {
    const parsed = IrCharacteristicModifier.parse({
      characteristic: "Sv",
      profileType: "Unit",
      kind: "set",
      value: "2+",
      targetScope: "model",
      targetId: "9cfd-entry-id",
      recursive: true,
    });
    expect(parsed.characteristic).toBe("Sv");
    expect(parsed.profileType).toBe("Unit");
    expect(parsed.kind).toBe("set");
    expect(parsed.value).toBe("2+");
    expect(parsed.targetScope).toBe("model");
    expect(parsed.targetId).toBe("9cfd-entry-id");
    expect(parsed.recursive).toBe(true);
  });

  it("targetId is optional", () => {
    const parsed = IrCharacteristicModifier.parse({
      characteristic: "S", profileType: "Melee Weapons", kind: "increment",
      value: "1", targetScope: "self", recursive: false,
    });
    expect(parsed.targetId).toBeUndefined();
  });

  it("carries a gating condition", () => {
    const parsed = IrCharacteristicModifier.parse({
      characteristic: "M", profileType: "Unit", kind: "increment", value: "2",
      targetScope: "self", recursive: false,
      conditions: [{
        id: "cond.atLeast.e.x", comparator: "atLeast", value: 1,
        field: "selections", scope: "self", targetType: "entry",
        targetId: "e.x", includeChildSelections: false,
      }],
    });
    expect(parsed.conditions?.[0]?.targetId).toBe("e.x");
  });

  it("rejects an unsupported kind (append/replace/floor/ceil stay out of scope)", () => {
    for (const kind of ["append", "replace", "floor", "ceil"]) {
      expect(IrCharacteristicModifier.safeParse({
        characteristic: "Sv", profileType: "Unit", kind, value: "2+",
        targetScope: "self", recursive: false,
      }).success).toBe(false);
    }
  });

  it("defaults IrEntry.characteristicModifiers to [] when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.characteristicModifiers).toEqual([]);
  });

  it("carries characteristicModifiers on an entry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E",
      characteristicModifiers: [{
        characteristic: "T", profileType: "Unit", kind: "set", value: "6",
        targetScope: "model", recursive: true,
      }],
    });
    expect(e.characteristicModifiers?.[0]?.characteristic).toBe("T");
  });
});
