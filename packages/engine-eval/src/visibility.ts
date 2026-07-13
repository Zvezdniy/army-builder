import type { IrCatalogue, IrCondition, IrConditionGroup, Roster, VisibilityModifier } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState, type EvalNode, type EvalState } from "./state";
import { passesGate } from "./conditions";
import { resolveCategories } from "./categories";

// Scopes that resolve WITHOUT an owner/ancestor chain: self (the synthetic candidate
// node itself), force and roster (whole-roster). Every OTHER scope — the ancestor-relative
// keywords AND any foreign-id (entry-id) scope — needs a real ancestor chain to resolve, so
// an ownerless modifier using one is skipped: it can never over-hide by collapsing to
// self/0 (a foreign-id `lessThan 1` gate would otherwise fire spuriously against 0).
const OWNERLESS_SCOPES = new Set(["self", "force", "roster"]);

function conditionUsesContext(c: IrCondition): boolean {
  return !OWNERLESS_SCOPES.has(c.scope);
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
  const state = buildState(roster, catalogue);
  resolveCategories(state);
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

// A real roster node is hidden *by current army state* when it is visible by
// definition (static `hidden` false) but a visibility modifier hides it under the
// present roster — e.g. an enhancement gated to a detachment the roster no longer
// holds. Nodes that are statically `hidden: true` are EXCLUDED: those are
// structural, definitionally-hidden parts (the builder auto-seeds mandatory hidden
// children), permanently present rather than "no longer available", so warning on
// them is noise with the wrong meaning. Option-filtering (`hiddenEntryIds`) still
// honours static hidden — this narrowing is only for the "became unavailable"
// signal. Unlike hiddenEntryIds (ownerless synthetic candidate nodes, context-scope
// skip), a real node has its real ancestor chain, so every gate resolves directly.
// Modifiers apply in order; the last matching gate wins.
export function nodeHiddenByState(node: EvalNode, state: EvalState): boolean {
  if (node.entry.hidden) return false;
  let isHidden = false; // base is definitionally false here (guarded above)
  for (const m of node.entry.visibilityModifiers ?? []) {
    if (passesGate(m.conditions, m.conditionGroups, node, state)) isHidden = m.set;
  }
  return isHidden;
}

// selectionIds of roster nodes hidden by current state (see nodeHiddenByState).
// These are still valid data / still cost points — callers surface them as a
// warning, not a removal.
export function hiddenSelectionIds(roster: Roster, catalogue: IrCatalogue): Set<string> {
  const state = buildState(roster, catalogue);
  resolveCategories(state);
  const hidden = new Set<string>();
  for (const node of state.all) {
    if (nodeHiddenByState(node, state)) hidden.add(node.selectionId);
  }
  return hidden;
}
