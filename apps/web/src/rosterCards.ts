import type { Roster, IrCatalogue, IrEntry } from "@muster/domain";
import { selectedDetachment, enhancementsForDetachment } from "@muster/roster";
import { buildState, resolveCosts, type EvalNode } from "@muster/engine-eval";

export interface WargearLine { id: string; name: string; count: number; points: number }
export interface EnhancementLine { id: string; name: string; points: number }
export interface UnitBreakdown {
  /** The unit's own subtree points, using the same resolved costs as evaluate(). */
  points: number;
  /** Paid wargear upgrades only (points > 0), aggregated by name with a total count —
   *  free default weapons are omitted to keep the card tidy (they still appear in the
   *  Detailed text export). Mirrors War Organ's card presentation. */
  wargear: WargearLine[];
  /** Enhancements taken on this unit (always paid), listed separately from wargear. */
  enhancements: EnhancementLine[];
}

// A node resolves to a wargear item (not a model body): no Unit statline profile.
function isWargearEntry(entry: IrEntry): boolean {
  return !(entry.profiles ?? []).some((p) => p.typeName === "Unit");
}

/** Per-unit points, paid wargear, and enhancements for every top-level roster unit,
 *  keyed by selection id. Points come from the same buildState/resolveCosts machinery
 *  evaluate() uses, so a unit's figure matches its share of the on-screen total. */
export function unitBreakdowns(roster: Roster, catalogue: IrCatalogue): Map<string, UnitBreakdown> {
  // buildState throws if a selection's entryId is in neither the catalogue tree nor the
  // tolerant flat index (e.g. a roster built against a different catalogue revision). The
  // roster list must still render, so degrade to no per-unit figures rather than crash —
  // matching the tolerance the catalogueEntry-based rendering already had.
  let state: ReturnType<typeof buildState>;
  let costOf: ReturnType<typeof resolveCosts>["costOf"];
  try {
    state = buildState(roster, catalogue);
    costOf = resolveCosts(state).costOf;
  } catch (err) {
    // Tolerate a roster that references an entry absent from the catalogue (revision
    // drift) — buildState throws "Unknown entryId". Any OTHER error is an unexpected
    // regression: rethrow it rather than silently zeroing every card's figures.
    if (err instanceof Error && /Unknown entryId/.test(err.message)) return new Map();
    throw err;
  }
  const detId = selectedDetachment(roster, catalogue);
  const enhIds = new Set(detId !== undefined ? enhancementsForDetachment(catalogue, detId).map((e) => e.id) : []);

  const subtree = (n: EvalNode): number => {
    let sum = costOf(n);
    for (const c of n.children) sum += subtree(c);
    return sum;
  };
  // A wrapper node (a loadout-choice group) carries its wargear as descendants; list the
  // concrete leaves, not the wrapper's own label — matches unitLoadout's collapsing.
  const wrapsWargear = (n: EvalNode): boolean =>
    n.children.some((c) => isWargearEntry(c.entry) || wrapsWargear(c));

  const out = new Map<string, UnitBreakdown>();
  for (const root of state.roots) {
    // Aggregate by entry id (not display name) so identical items across a unit's models
    // merge into one "N× …" line, while two distinct entries that happen to share a name
    // stay separate — and the id gives each chip a stable, collision-free React key.
    const wargearById = new Map<string, { name: string; count: number; points: number }>();
    const enhancements: EnhancementLine[] = [];
    const seenEnh = new Set<string>();
    const visit = (n: EvalNode, depth: number): void => {
      if (depth > 0 && enhIds.has(n.entry.id)) {
        // An enhancement is its own line, never folded into wargear; don't descend into
        // its internals looking for wargear either.
        if (!seenEnh.has(n.entry.id)) { seenEnh.add(n.entry.id); enhancements.push({ id: n.entry.id, name: n.entry.name, points: subtree(n) }); }
        return;
      }
      if (depth > 0 && isWargearEntry(n.entry) && !wrapsWargear(n)) {
        const prev = wargearById.get(n.entry.id) ?? { name: n.entry.name, count: 0, points: 0 };
        wargearById.set(n.entry.id, { name: prev.name, count: prev.count + n.effectiveCount, points: prev.points + subtree(n) });
      }
      for (const c of n.children) visit(c, depth + 1);
    };
    visit(root, 0);

    const wargear: WargearLine[] = [...wargearById]
      .filter(([, v]) => v.points > 0) // paid upgrades only (WO-style card)
      .map(([id, v]) => ({ id, name: v.name, count: v.count, points: v.points }));
    out.set(root.selectionId, { points: subtree(root), wargear, enhancements });
  }
  return out;
}
