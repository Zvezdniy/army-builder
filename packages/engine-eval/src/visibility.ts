import type { IrCatalogue, IrCondition, IrConditionGroup, Roster, VisibilityModifier } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState, type EvalNode } from "./state";
import { passesGate } from "./conditions";

// Scopes that need a real ancestor chain to resolve. Without one (no owner), a
// modifier using them is skipped so it can never over-hide by collapsing to self.
const CONTEXT_SCOPES = new Set(["parent", "root-entry", "ancestor"]);

function conditionUsesContext(c: IrCondition): boolean {
  return CONTEXT_SCOPES.has(c.scope);
}
function groupUsesContext(g: IrConditionGroup): boolean {
  return (g.conditions ?? []).some(conditionUsesContext) || (g.conditionGroups ?? []).some(groupUsesContext);
}
function usesContextScope(m: VisibilityModifier): boolean {
  return (m.conditions ?? []).some(conditionUsesContext) || (m.conditionGroups ?? []).some(groupUsesContext);
}

// Catalogue entry ids whose effective `hidden` is true given the roster. When
// `ownerSelectionId` is supplied, each candidate's synthetic node is parented to
// that owner node, so parent/root-entry/ancestor scopes resolve against the real
// ancestor chain (in-unit option visibility). Without an owner, gates that use a
// context scope are skipped (never over-hide).
export function hiddenEntryIds(
  roster: Roster,
  catalogue: IrCatalogue,
  ownerSelectionId?: string,
): Set<string> {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const owner = ownerSelectionId
    ? state.all.find((n) => n.selectionId === ownerSelectionId) ?? null
    : null;
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
      parent: owner,
      children: [],
    };
    let isHidden = entry.hidden ?? false;
    for (const m of mods) {
      // Skip is symmetric on `set`: a context-scoped modifier is skipped without an
      // owner whether it hides (set:true) or reveals (set:false). Skipping a reveal
      // leaves the entry as-is (never hides more), so this stays never-over-hide; and
      // the only ownerless UI path (the top-level unit picker) never carries an
      // ancestor-scoped gate in real data.
      if (owner === null && usesContextScope(m)) continue;
      if (passesGate(m.conditions, m.conditionGroups, synth, state)) isHidden = m.set;
    }
    if (isHidden) hidden.add(entry.id);
  }
  return hidden;
}
