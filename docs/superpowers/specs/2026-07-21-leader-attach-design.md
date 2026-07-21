# Leader-attach (v1) — Design

**Date:** 2026-07-21
**Status:** Design (pragmatic v1, scope approved)

## Problem

In 10th/11th-edition 40k a **Leader** (a Character unit) can be *attached* to an
eligible **Bodyguard** unit, forming one combined unit on the table. The builder
currently has no way to express this: a Character and its squad are two unrelated
top-level units in the roster. Players expect to attach a Leader to a squad and
see the relationship reflected.

The eligibility data already exists in the packed IR. Every Leader unit carries an
**"Leader" ability profile** (`typeName: "Abilities"`, `name: "Leader"`) whose
`Description` characteristic names the units it may join, e.g.:

```
This model can be attached to the following units:
■ Assault Intercessor Squad
■ Infernus Squad
■ Intercessor Squad
```

No parser change is needed — the ability text is already inlined onto the unit's
`profiles` (the infoLink-profile-resolution pass shipped earlier guarantees this).
The gap is entirely in the **roster model** (no attachment relationship) and the
**app** (no parse, no UI).

## Scope (v1 — pragmatic)

**In scope:**
- Detect a unit is a Leader (has a "Leader" ability profile).
- Parse its eligible target unit **names** from the ability Description.
- Offer, in the roster, the Leader's eligible **targets that are actually present**
  in the current roster and not already led.
- Store the attachment (Leader → Bodyguard) in the roster domain.
- Show the relationship in the builder: the Leader rendered under its Bodyguard
  with a "leading …" marker (the roster list shows model counts, not per-unit
  points, so v1 adds no points subtotal — see Non-goals).
- Legality guard **at the attach operation**: only an eligible, un-led target;
  at most one Leader per Bodyguard.

**Explicitly deferred (out of v1):**
- Keyword-based eligibility (`… ■ TACTICUS (Excluding CHARACTER and FLY)`): where a
  parsed name does not resolve to a roster unit's name, the row simply degrades to
  "no eligible target" — safe, silent, no false offers.
- Two Leaders on one unit (a few datasheets allow it).
- Merging the combined unit's datasheet / abilities / characteristics.
- "While attached" conditional modifiers.
- Transport interactions and Leader-specific stratagem hooks.
- Engine-level (`evaluate`) legality of attachment — v1 prevents illegal
  attachments at the operation instead of reporting them post-hoc.

## Data grounding (real 11e catalogues)

Surveyed all 11e factions. The "Leader" ability Description always begins
`This model can be attached to the following unit(s):` and then lists names in one
of four markup styles (counts are lines observed):

| Style | Example fragment |
|-------|------------------|
| `■` bullet, one per line | `\n\n■ Intercessor Squad` (may be ALL-CAPS: `■ AGGRESSOR SQUAD`) |
| `-` bullet, bold/markup | `\n- **^^Tactical Squad^^**` |
| inline, comma-separated | ` ^^**Seraphim Squad, Zephyrim Squad**^^` |
| keyword + exclusions (deferred) | `\n- **^^Tacticus^^** (Excluding ^^**Character^^** …)` |

The parser must strip the BattleScribe emphasis tokens `^^` and `**`, split on
newlines / bullets (`■`, leading `-`) **and** commas, drop any parenthetical
`(Excluding …)` clause, trim, and yield clean candidate names. ALL-CAPS names match
their catalogue units case-insensitively.

## Architecture

Two layers change; the parser and engine do not.

### 1. Domain — `packages/domain/src/roster.ts`

Add one optional field to `RosterSelection`:

```ts
attachedTo: z.string().optional(),  // Bodyguard selection id this Leader is attached to
```

Additive and optional — existing rosters validate unchanged. Only ever set on a
top-level Leader selection; both Leader and Bodyguard **remain top-level units**, so
per-unit points / legality / datasheet all keep working exactly as today. The
attachment is a soft reference, not a tree re-parenting.

### 2. Roster — new file `packages/roster/src/leader.ts`

Isolated from the already-large `builder.ts`, re-exported from `index.ts`. Pure,
immutable, 100%-covered (package gate). Public surface:

```ts
// The unit's "Leader" ability Description text, or undefined if it is not a Leader.
export function leaderAbilityText(catalogue: IrCatalogue, entryId: string): string | undefined;

// Parse eligible target unit names out of a Leader ability Description.
// Returns [] for keyword-only / unparseable descriptions.
export function parseAttachTargets(description: string): string[];

// True when this unit entry carries a "Leader" ability profile.
export function isLeaderUnit(catalogue: IrCatalogue, entryId: string): boolean;

// For a Leader selection, the roster units it may attach to right now:
// eligible by name (case-insensitive) AND not already led by another Leader.
export function leaderTargets(
  roster: Roster, catalogue: IrCatalogue, leaderSelectionId: string,
): { bodyguardSelectionId: string; bodyguardName: string }[];

// The Leaders currently attached to a given Bodyguard (v1: 0 or 1).
export function attachedLeaders(roster: Roster, bodyguardSelectionId: string): RosterSelection[];

// Guarded attach. No-op (returns roster unchanged) if the target is ineligible
// or already led. Sets leader.attachedTo = bodyguardSelectionId.
export function attachLeader(
  roster: Roster, catalogue: IrCatalogue, leaderSelectionId: string, bodyguardSelectionId: string,
): Roster;

// Clear the attachment.
export function detachLeader(roster: Roster, leaderSelectionId: string): Roster;
```

**Dangling-reference cleanup:** `remove()` in `builder.ts` (which already prunes a
selection subtree) must additionally clear `attachedTo` on any selection whose value
points at a removed selection id. Removing a Bodyguard therefore auto-detaches its
Leader; removing a Leader drops its own attachment with the subtree.

### 3. App — `apps/web`

- **`UnitDetail`** (the Leader's config panel): a new "Attach to unit" section,
  rendered only when `isLeaderUnit`. States, mirroring the F2 enhancement rows:
  - *Attached* → `Leading <bodyguard name>` + a **Detach** button (`detachLeader`).
  - *Not attached, targets exist* → a button per `leaderTargets` entry (`attachLeader`).
  - *Not attached, no targets* → hint: "Add an eligible unit to this roster to attach."
- **`RosterList`**: an attached Leader is rendered indented beneath its Bodyguard
  with a "leading" marker; the Leader no longer appears in its own role bucket while
  attached (it moves under the Bodyguard). Un-attached units render as today. No
  points subtotal — the list shows model counts, not per-unit points.
- **`App.tsx`** wires `attachLeader` / `detachLeader` into `setRoster`, like the
  existing `onToggleGroupMember` handlers.

## Data flow

```
IR (unit.profiles → "Leader" ability → Description)
   │  leaderAbilityText / parseAttachTargets   (pure, roster pkg)
   ▼
eligible names ──intersect── roster top-level unit names (case-insensitive, un-led)
   │  leaderTargets
   ▼
UnitDetail "Attach to unit" ──user click──▶ attachLeader ──▶ RosterSelection.attachedTo set
   │                                                              │
   ▼                                                              ▼
RosterList groups Leader under Bodyguard (no points)          remove() clears dangling refs
```

## Testing

- **`leader.ts` unit tests (roster pkg, 100% branch coverage required):**
  - `parseAttachTargets` fixtures for each real markup style (■ bullet, ALL-CAPS
    bullet, `-` bold bullet, inline comma-separated), plus keyword+exclusion → `[]`,
    plus empty/non-Leader description → `[]`.
  - `isLeaderUnit` / `leaderAbilityText` on a Leader vs a plain unit.
  - `leaderTargets`: eligible present target offered; absent name not offered;
    already-led target excluded; case-insensitive match.
  - `attachLeader` guards: ineligible target → unchanged; already-led → unchanged;
    happy path sets `attachedTo`. `detachLeader` clears it. Immutability (input
    roster not mutated).
  - `attachedLeaders` returns the attached Leader; empty otherwise.
- **`builder.test.ts`:** `remove()` clears a dangling `attachedTo` when the Bodyguard
  is removed.
- **Web component tests:** `UnitDetail` renders the three attach states and fires the
  handlers; `RosterList` renders an attached Leader grouped under its Bodyguard (and
  not in its own role bucket).

## Non-goals recap

No parser or engine changes. No datasheet merging. No keyword eligibility. No
two-Leader units. These are deliberate v1 cuts; the model (`attachedTo` +
`leader.ts`) leaves room to add them later without rework.
