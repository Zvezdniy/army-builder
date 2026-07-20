import type { IrCatalogue, IrCharacteristic, IrCharacteristicModifier, IrProfile, Roster } from "@muster/domain";
import type { EvalNode } from "./state";
import { buildState } from "./state";
import { scopeNodes, subtree } from "./scopes";
import { passesGate } from "./conditions";
import { resolveCategories } from "./categories";

// Mirrors @muster/roster's `DatasheetSection` (packages/roster/src/builder.ts) shape
// exactly, byte-for-byte, so apps/web can switch from `datasheet()` to
// `effectiveDatasheet()` with no render-logic change. Duplicated rather than
// imported: see the "roster/eval boundary" note on `effectiveDatasheet` below.
export interface DatasheetSection {
  typeName: string;
  profiles: IrProfile[];
}

interface OwnedModifier {
  owner: EvalNode;
  modifier: IrCharacteristicModifier;
}

/** `name`+`typeName`+characteristics identity key — identical to
 *  @muster/roster's private `profileKey`, kept in lockstep deliberately (see
 *  module doc comment). */
function profileKey(p: IrProfile): string {
  const chars = p.characteristics.map((c) => `${c.name}=${c.value}`).join("|");
  return `${p.typeName}|${p.name}|${chars}`;
}

/** Split a display-string characteristic value into a leading integer and its
 *  untouched suffix: `"10\""` -> `{n:10, suffix:'"'}`, `"2+"` -> `{n:2,
 *  suffix:"+"}`. Returns null when there is no leading integer (e.g. `"D6"`) —
 *  callers must leave such a value UNCHANGED rather than corrupt it. */
function splitLeadingInt(value: string): { n: number; suffix: string } | null {
  const m = value.match(/^(\d+)(.*)$/s);
  if (!m) return null;
  // Both capture groups are always present on a successful match of this
  // pattern (group 1 requires >=1 digit, group 2 is `.*` which matches even
  // an empty tail) — non-null assertions, not a real optionality.
  return { n: Number(m[1]!), suffix: m[2]! };
}

/** A characteristic-modifier's `value` is the increment/decrement MAGNITUDE
 *  (a bare integer string, e.g. "2") when kind isn't "set" — parsed straight,
 *  no suffix to preserve (only the target characteristic's current value keeps
 *  its suffix). Non-integer magnitudes (shouldn't occur for numeric kinds, but
 *  never trust upstream data) are treated as unparseable, same as a
 *  non-numeric target value. */
function parseDelta(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function warnUnparseable(modifier: IrCharacteristicModifier, currentValue: string): void {
  // eslint-disable-next-line no-console -- deliberate diagnostic channel; see
  // the module doc comment ("Diagnostics" boundary decision).
  console.warn(
    `[effectiveDatasheet] cannot ${modifier.kind} characteristic "${modifier.characteristic}" ` +
      `on profile type "${modifier.profileType}" (current value "${currentValue}", modifier value ` +
      `"${modifier.value}") — no leading integer to modify; value left unchanged.`,
  );
}

function applyModifier(characteristic: IrCharacteristic, modifier: IrCharacteristicModifier): void {
  if (modifier.kind === "set") {
    characteristic.value = modifier.value;
    return;
  }
  const current = splitLeadingInt(characteristic.value);
  const delta = parseDelta(modifier.value);
  if (!current || delta === null) {
    warnUnparseable(modifier, characteristic.value);
    return;
  }
  const next = modifier.kind === "increment" ? current.n + delta : current.n - delta;
  characteristic.value = `${next}${current.suffix}`;
}

function buildSections(nodes: EvalNode[], working: Map<EvalNode, IrProfile[]>): DatasheetSection[] {
  const sections: DatasheetSection[] = [];
  const byType = new Map<string, DatasheetSection>();
  const seen = new Set<string>();

  for (const node of nodes) {
    // Every node in `nodes` was seeded into `working` above, so this is never
    // undefined — non-null, not `?? []`, to keep that guarantee visible (and
    // out of branch coverage as a false safety net).
    for (const profile of working.get(node)!) {
      const key = profileKey(profile);
      if (seen.has(key)) continue;
      seen.add(key);
      let section = byType.get(profile.typeName);
      if (!section) {
        section = { typeName: profile.typeName, profiles: [] };
        byType.set(profile.typeName, section);
        sections.push(section);
      }
      section.profiles.push(profile);
    }
  }
  return sections;
}

/**
 * `targetScope:"self"` on a characteristic modifier comes from the BattleScribe
 * `self.entries...` `affects` grammar, OR from `parse_affects`'s shared
 * empty-scope fallback (a modifier that omits `scope` entirely, on any of the
 * three `affects` arms — see `resolve_target_scope` in `engine-parser`'s
 * `map.rs`). In the `self.entries...` case `.entries` means "descend into
 * this anchor's child entries", the same CONTAINER semantics `scopes.ts`
 * already gives every other scope keyword (`parent`/`root-entry`/`model`/...)
 * via `containerScope`: non-recursive still reaches the anchor's DIRECT
 * CHILDREN, not just the anchor itself. `scopes.ts`'s own `"self"` case is the
 * one exception — it uses bare `subtree()`, which for `includeChildSelections:
 * false` returns ONLY the owner node — because that case is shared with
 * conditions/constraints, where `scope:"self"` legitimately means "the
 * selection itself" with no such grammar behind it. Changing `scopes.ts`
 * would regress every other consumer, so this container behavior is
 * reproduced HERE, characteristics-only, instead.
 *
 * Real 11e BSData proof (Necrons "Catacomb Command Barge" / "Overlord with
 * Translocation Shroud"): an `increment` on the Ranged/Melee Weapons `S`
 * characteristic, `scope` omitted (-> `self` per Fix 1's fallback),
 * `affects="self.entries.profiles.Ranged Weapons"` (non-recursive). The OWNER
 * (the model entry) carries no Ranged/Melee Weapons profile at all — only its
 * direct-child weapon-option entries do. Resolving "self" as owner-only
 * (`scopes.ts`'s behavior) finds zero matching profiles and the modifier
 * silently never applies; resolving it as owner+direct-children (this
 * function) reaches the weapon entries as BattleScribe intends.
 *
 * Returns `null` for every other scope (or `recursive: true`, where
 * `subtree(node, true)` — owner + full descendant subtree — already matches
 * `containerScope`'s recursive branch exactly, so no divergence exists) so
 * the caller falls through to the shared `scopeNodes` resolution unchanged.
 */
function selfScopeContainerNodes(owner: EvalNode, modifier: IrCharacteristicModifier): EvalNode[] | null {
  if (modifier.targetScope !== "self" || modifier.recursive) return null;
  return [owner, ...owner.children];
}

/**
 * The live, EFFECTIVE datasheet for a unit selection: the same
 * `DatasheetSection[]` shape as `@muster/roster`'s `datasheet()`, but with
 * numeric characteristic modifiers (B1's `IrEntry.characteristicModifiers`:
 * `set`/`increment`/`decrement`) applied — so e.g. an Artificer Armour
 * enhancement shows the model's Unit `Sv` as `2+` instead of the base `3+`.
 *
 * Algorithm (design doc §3):
 *  1. Collect every `characteristicModifiers` entry anywhere in the selected
 *     subtree, paired with its OWNING node (a modifier can target a profile on
 *     a different entry than the one that declares it).
 *  2. Gate each via the existing condition machinery (`passesGate`) against a
 *     live `EvalState` built from the whole roster.
 *  3. Resolve `targetScope` from the owning node to an anchor/subtree of nodes
 *     (reusing `scopes.ts`'s `scopeNodes` — the exact anchor-walk conditions
 *     and constraints already use for the same scope vocabulary), filtered to
 *     `profileType` and an optional `targetId` — which real 11e data proves is
 *     usually a CATEGORY id, not an entry id (see `characteristics.ts`'s own
 *     matching below), so a candidate node matches when `targetId` is absent,
 *     equals `node.entry.id`, OR appears in `node.categories`.
 *  4. Apply in modifier-declaration order: `set` replaces the value outright;
 *     `increment`/`decrement` parse a leading integer out of the CURRENT
 *     value, apply the delta, and splice the new number back before the
 *     untouched suffix. A value with no parseable leading integer is left
 *     UNCHANGED and a diagnostic is logged — never corrupted.
 *
 * Roster/eval boundary: `@muster/roster` must gain no dependency on
 * `engine-eval` (architectural constraint), and this package does not import
 * `@muster/roster` back either — `datasheet()` isn't reused, its walk is
 * mirrored here instead (grouped by `typeName` in first-seen order, deduped by
 * `name+typeName+characteristics`) directly over `EvalState`'s already-resolved
 * `EvalNode` tree (which `buildState` gives us for free — no second tree walk
 * against `RosterSelection` is needed). This keeps the package boundary
 * strictly one-directional (roster ⊥ eval) and avoids a second implementation
 * of catalogue-entry resolution: `buildState` already resolves each
 * `RosterSelection` to its `IrEntry` exactly as `datasheet()`'s own
 * `catalogueEntry` lookup would.
 *
 * One deliberate divergence from a naive "reuse datasheet() then patch
 * values" approach: dedup runs AFTER modifiers are applied (not before). Two
 * originally-identical profiles (e.g. two squad members with the same weapon)
 * that diverge because only one of them carries an active modifier must render
 * as two distinct rows, not collapse into one and then get double-patched or
 * lose one variant. For a unit with no characteristic modifiers, the working
 * copies are structurally identical to the originals, so grouping/dedup/order
 * exactly match `datasheet()`'s output (verified by a dedicated test).
 */
export function effectiveDatasheet(catalogue: IrCatalogue, roster: Roster, selectionId: string): DatasheetSection[] {
  const state = buildState(roster, catalogue);
  // Every other EvalState consumer (evaluate.ts, visibility.ts) resolves
  // conditional category membership right after buildState — required here
  // too: `targetId` is overwhelmingly a CATEGORY id (see the module doc
  // comment above), and the target filter below reads `node.categories`.
  // Without this, a conditionally-ADDED category never matches (the modifier
  // is silently skipped) and a conditionally-REMOVED one still matches (the
  // modifier wrongly applies) — and the modifiers' own condition gates
  // (`passesGate`, which can itself read `node.categories` via a
  // category-scoped condition) would evaluate against stale membership,
  // diverging from what the same roster produces in `evaluate()`.
  resolveCategories(state);
  const root = state.all.find((n) => n.selectionId === selectionId);
  if (!root) throw new Error(`Unknown selectionId in roster: ${selectionId}`);

  const nodes = subtree(root, true);

  // Deep-clone every node's profiles into a mutable working copy so modifiers
  // never touch the shared catalogue's IrEntry/IrProfile objects.
  const working = new Map<EvalNode, IrProfile[]>();
  for (const node of nodes) {
    working.set(
      node,
      (node.entry.profiles ?? []).map((p) => ({
        ...p,
        characteristics: p.characteristics.map((c) => ({ ...c })),
      })),
    );
  }

  const modifiers: OwnedModifier[] = [];
  for (const node of nodes) {
    for (const modifier of node.entry.characteristicModifiers ?? []) {
      modifiers.push({ owner: node, modifier });
    }
  }

  for (const { owner, modifier } of modifiers) {
    if (!passesGate(modifier.conditions, modifier.conditionGroups, owner, state)) continue;

    const anchorNodes = selfScopeContainerNodes(owner, modifier) ?? scopeNodes(
      owner,
      { scope: modifier.targetScope, includeChildSelections: modifier.recursive },
      state,
    );
    const targetNodes = anchorNodes.filter((n) => {
      // `targetId` is a raw id captured off the `affects` path — real 11e
      // data shows it's overwhelmingly a CATEGORY id (e.g. "Character"), not
      // an entry id, though the entry-id shape is also observed. Match
      // either, same precedent as `scopes.ts`'s `matchesTarget`.
      if (
        modifier.targetId &&
        n.entry.id !== modifier.targetId &&
        !n.categories.includes(modifier.targetId)
      ) {
        return false;
      }
      return (n.entry.profiles ?? []).some((p) => p.typeName === modifier.profileType);
    });

    for (const target of targetNodes) {
      // A resolved target outside the datasheet's own subtree (e.g. a
      // roster/force-scoped modifier) has nothing to patch here — it isn't
      // part of THIS unit's rendered datasheet.
      const profiles = working.get(target);
      if (!profiles) continue;
      for (const profile of profiles) {
        if (profile.typeName !== modifier.profileType) continue;
        const characteristic = profile.characteristics.find((c) => c.name === modifier.characteristic);
        if (!characteristic) continue;
        applyModifier(characteristic, modifier);
      }
    }
  }

  return buildSections(nodes, working);
}
