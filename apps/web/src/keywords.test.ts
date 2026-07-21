import { describe, it, expect } from "vitest";
import type { IrProfile } from "@muster/domain";
import { baseKeyword, weaponKeywords, makeRuleResolver } from "./keywords";

const weapon = (over: Partial<IrProfile>): IrProfile => ({
  name: "W", typeName: "Ranged Weapons", characteristics: [], ...over,
});

describe("baseKeyword", () => {
  it("strips a trailing numeric / N+ parameter", () => {
    expect(baseKeyword("Sustained Hits 2")).toBe("Sustained Hits");
    expect(baseKeyword("Rapid Fire 1")).toBe("Rapid Fire");
    expect(baseKeyword("Rapid Fire 10")).toBe("Rapid Fire");
    expect(baseKeyword("Melta 2")).toBe("Melta");
  });
  it("strips a trailing DICE parameter (D3 / D6 / D6+3)", () => {
    expect(baseKeyword("Rapid Fire D3")).toBe("Rapid Fire");
    expect(baseKeyword("Rapid Fire D6")).toBe("Rapid Fire");
    expect(baseKeyword("Rapid Fire D6+3")).toBe("Rapid Fire");
    expect(baseKeyword("Sustained Hits D3")).toBe("Sustained Hits");
  });
  it("collapses any Anti-<type> N+ to the generic Anti rule", () => {
    expect(baseKeyword("Anti-Vehicle 3+")).toBe("Anti");
    expect(baseKeyword("Anti-VEHICLE 3+")).toBe("Anti");
    expect(baseKeyword("Anti-Infantry 4+")).toBe("Anti");
  });
  it("leaves a bare keyword untouched", () => {
    expect(baseKeyword("Assault")).toBe("Assault");
    expect(baseKeyword("Devastating Wounds")).toBe("Devastating Wounds");
  });
});

describe("weaponKeywords", () => {
  it("reads the comma-separated Keywords characteristic (real data)", () => {
    const kws = weaponKeywords(weapon({
      characteristics: [
        { name: "S", value: "5" },
        { name: "Keywords", value: "Anti-Vehicle 3+, Sustained Hits 2" },
      ],
    }));
    expect(kws).toEqual([
      { label: "Anti-Vehicle 3+", ruleKey: "Anti" },
      { label: "Sustained Hits 2", ruleKey: "Sustained Hits" },
    ]);
  });

  it("skips the '-' / blank no-keyword marker", () => {
    expect(weaponKeywords(weapon({ characteristics: [{ name: "Keywords", value: "-" }] }))).toEqual([]);
    expect(weaponKeywords(weapon({ characteristics: [{ name: "Keywords", value: "" }] }))).toEqual([]);
  });

  it("dedupes repeated tokens by label", () => {
    const kws = weaponKeywords(weapon({ characteristics: [{ name: "Keywords", value: "Pistol, Pistol" }] }));
    expect(kws).toEqual([{ label: "Pistol", ruleKey: "Pistol" }]);
  });

  it("falls back to the profile.keywords array (bundled mini40k shape)", () => {
    const kws = weaponKeywords(weapon({ characteristics: [{ name: "S", value: "4" }], keywords: ["Precision"] }));
    expect(kws).toEqual([{ label: "Precision", ruleKey: "Precision" }]);
  });
});

describe("makeRuleResolver", () => {
  it("matches exactly, then case-insensitively", () => {
    const resolve = makeRuleResolver({ "Anti": "Anti rule.", "Sustained Hits": "Sustained rule." });
    expect(resolve("Anti")).toBe("Anti rule.");
    expect(resolve("anti")).toBe("Anti rule."); // case drift in the source token
    expect(resolve("Unknown")).toBeUndefined();
  });
  it("bridges punctuation/spacing drift (Twin Linked token vs Twin-linked rule)", () => {
    // Real Aeldari/Drukhari/Ynnari data: weapon token "Twin Linked", rule keyed "Twin-linked".
    const resolve = makeRuleResolver({ "Twin-linked": "Re-roll the Hit roll." });
    expect(resolve("Twin Linked")).toBe("Re-roll the Hit roll.");
  });
  it("returns undefined for every key when the catalogue has no ruleTexts", () => {
    expect(makeRuleResolver(undefined)("Anti")).toBeUndefined();
  });
});
