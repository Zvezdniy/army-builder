import type { IrCatalogue, Roster } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState, type EvalNode } from "./state";
import { passesGate } from "./conditions";

// Catalogue entry ids whose effective `hidden` is true given the current roster.
// Each entry's visibility is folded from its static `hidden` plus its
// visibilityModifiers, evaluated against a synthetic self-node (roster/force
// scopes read the real roster state; self reads the synthetic entry node).
// The parser guarantees every visibilityModifier's conditions use only
// self/force/roster scopes, so no unresolved-scope case reaches here.
export function hiddenEntryIds(roster: Roster, catalogue: IrCatalogue): Set<string> {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const hidden = new Set<string>();
  for (const entry of symbols.values()) {
    const mods = entry.visibilityModifiers ?? [];
    if (mods.length === 0) {
      if (entry.hidden) hidden.add(entry.id);
      continue;
    }
    const synth: EvalNode = {
      selectionId: `synthetic:${entry.id}`,
      entry,
      count: 1,
      multiplier: 1,
      effectiveCount: 1,
      categories: entry.categories,
      parent: null,
      children: [],
    };
    let isHidden = entry.hidden ?? false;
    for (const m of mods) {
      if (passesGate(m.conditions, m.conditionGroups, synth, state)) {
        isHidden = m.set;
      }
    }
    if (isHidden) hidden.add(entry.id);
  }
  return hidden;
}
