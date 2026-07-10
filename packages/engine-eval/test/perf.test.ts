import { describe, it, expect } from "vitest";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, rosterWith, sel } from "./fixtures/mini40k";

describe("evaluate performance", () => {
  it("evaluates a ~2000-point roster well under 50ms", () => {
    // ~20 units (~2000 pts of Heavy/Troops) + HQ.
    const selections = [sel("e.captain")];
    for (let i = 0; i < 10; i++) selections.push(sel("e.heavy"));
    for (let i = 0; i < 5; i++) selections.push(sel("e.troops"));
    const roster = rosterWith(selections, 2500);

    // Warm up, then measure a single re-eval.
    evaluate(roster, mini40kCatalogue);
    const start = performance.now();
    evaluate(roster, mini40kCatalogue);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
