import type { IrCatalogue, IrCharacteristic, IrCharacteristicModifier, IrProfile, Roster } from "@muster/domain";
import type { EvalNode } from "./state";
import { buildState } from "./state";
import { scopeNodes, subtree } from "./scopes";
import { passesGate } from "./conditions";

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
 *     `profileType` and optional `targetEntryId`.
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

    const anchorNodes = scopeNodes(
      owner,
      { scope: modifier.targetScope, includeChildSelections: modifier.recursive },
      state,
    );
    const targetNodes = anchorNodes.filter((n) => {
      if (modifier.targetEntryId && n.entry.id !== modifier.targetEntryId) return false;
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
