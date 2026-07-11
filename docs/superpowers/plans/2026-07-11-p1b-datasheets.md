# P1-b Datasheets (profiles/statlines) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry BattleScribe `<profiles>` through the whole pipeline (Rust parser → IR → domain → `@muster/roster` → web) and render a live datasheet (statline / weapon tables / abilities / keywords) for the selected unit.

**Architecture:** Each `<profile>` is self-contained (carries `typeName`; each `<characteristic>` carries its own `name`), so we do NOT parse `<profileTypes>` and preserve characteristic order as-authored. Weapons are upgrade entries with their own weapon profiles, so a unit's datasheet is the aggregation of profiles across its selected subtree — the "live datasheet" behaviour.

**Tech Stack:** Rust (quick-xml, serde) parser; TypeScript (Zod) domain; `@muster/roster` pure TS; React 18 + Vite web.

## Global Constraints

- Rust crate name is `engine-parser` (NOT `muster-engine-parser`); crate has `#![forbid(unsafe_code)]` — keep it.
- `cargo` runs from `packages/engine-parser` (no root Cargo.toml).
- `@muster/roster` and `@muster/domain` enforce 100% coverage via shared `vitest.shared.ts`, which EXCLUDES `src/index.ts` — all logic lives in `builder.ts`/module files, `index.ts` is a barrel only.
- `apps/web` runs jsdom vitest WITHOUT coverage thresholds.
- Golden `tests/fixtures/golden/mini40k.ir.json` is regenerated only deliberately; `mini40k.catz` is a zip containing `mini40k.cat` and MUST be regenerated whenever `mini40k.cat` changes (the golden suite asserts `.cat` and `.catz` parse identically).
- serde structs use `#[serde(rename_all = "camelCase")]`; `skip_serializing_if = "Vec::is_empty"` on optional vectors.
- Identifiers/code/comments/commit messages in English.
- Do NOT commit BSData data files or `.claude/settings.local.json`. Remove any temporary `examples/*.rs` after use.

---

### Task 1: Rust raw layer — parse `<profiles>`

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs`
- Modify: `packages/engine-parser/src/raw/parse.rs`
- Test: `packages/engine-parser/tests/raw_parse.rs`

**Interfaces:**
- Produces: `RawProfile { id: String, name: String, type_name: String, characteristics: Vec<RawCharacteristic> }`, `RawCharacteristic { name: String, value: String }`; `RawEntry.profiles: Vec<RawProfile>`; `RawGroup.profiles: Vec<RawProfile>`. Fn `read_profiles_into(dst: &mut Vec<RawProfile>, r: &mut SafeXmlReader) -> Result<(), ParseError>`.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine-parser/tests/raw_parse.rs`:

```rust
#[test]
fn reads_profiles_with_characteristics() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.hero" name="Hero" type="model">
      <profiles>
        <profile id="p.u" name="Hero" typeName="Unit">
          <characteristics>
            <characteristic name="M">6&quot;</characteristic>
            <characteristic name="T">4</characteristic>
          </characteristics>
        </profile>
      </profiles>
      <selectionEntryGroups>
        <selectionEntryGroup id="g.w" name="Wargear">
          <selectionEntries>
            <selectionEntry id="e.sword" name="Sword" type="upgrade">
              <profiles>
                <profile id="p.s" name="Sword" typeName="Melee Weapons">
                  <characteristics>
                    <characteristic name="Range">Melee</characteristic>
                    <characteristic name="AP">-2</characteristic>
                  </characteristics>
                </profile>
              </profiles>
            </selectionEntry>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    let hero = raw.entries.iter().find(|e| e.id == "e.hero").unwrap();
    let unit = hero.profiles.iter().find(|p| p.type_name == "Unit").unwrap();
    assert_eq!(unit.name, "Hero");
    assert_eq!(unit.characteristics[0].name, "M");
    assert_eq!(unit.characteristics[0].value, "6\"", "XML entity unescaped");
    assert_eq!(unit.characteristics[1].value, "4");

    // profile nested inside a selectionEntryGroup is read on the group's entry
    let group = hero.groups.iter().find(|g| g.id == "g.w").unwrap();
    let sword = group.entries.iter().find(|e| e.id == "e.sword").unwrap();
    let mp = &sword.profiles[0];
    assert_eq!(mp.type_name, "Melee Weapons");
    assert_eq!(mp.characteristics[0].value, "Melee");
    assert_eq!(mp.characteristics[1].value, "-2");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine-parser && cargo test --test raw_parse reads_profiles_with_characteristics`
Expected: FAIL to compile (`profiles` field does not exist on `RawEntry`).

- [ ] **Step 3: Add the raw structs and fields**

In `packages/engine-parser/src/raw/model.rs`, add fields and structs.

Add `pub profiles: Vec<RawProfile>,` to `RawEntry` (after `entry_links`):
```rust
    pub entry_links: Vec<RawEntryLink>,
    pub profiles: Vec<RawProfile>,
}
```

Add `pub profiles: Vec<RawProfile>,` to `RawGroup` (after `modifiers`):
```rust
    pub modifiers: Vec<RawModifier>,
    pub profiles: Vec<RawProfile>,
}
```

Append the new structs near the other `Raw*` structs:
```rust
#[derive(Debug, Default, Clone)]
pub struct RawProfile {
    pub id: String,
    pub name: String,
    pub type_name: String,
    pub characteristics: Vec<RawCharacteristic>,
}
#[derive(Debug, Default, Clone)]
pub struct RawCharacteristic {
    pub name: String,
    pub value: String,
}
```

- [ ] **Step 4: Add the profile readers and wire them in**

In `packages/engine-parser/src/raw/parse.rs`, add a `b"profiles"` arm to the `Event::Start` match in BOTH `read_entry` (after the `b"modifiers"` arm) and `read_group` (after the `b"modifiers"` arm):
```rust
                    b"profiles" => read_profiles_into(&mut entry.profiles, r)?,
```
(and in `read_group`, `&mut group.profiles`).

Add these functions near `read_costs_into`:
```rust
fn read_profiles_into(dst: &mut Vec<RawProfile>, r: &mut SafeXmlReader) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"profile" => {
                    dst.push(read_profile(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"profile" => {
                    dst.push(RawProfile {
                        id: attr(&e, b"id").unwrap_or_default(),
                        name: attr(&e, b"name").unwrap_or_default(),
                        type_name: attr(&e, b"typeName").unwrap_or_default(),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"profiles" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml("unexpected EOF in profiles".to_string()))
            }
        }
    }
}

fn read_profile(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawProfile, ParseError> {
    let mut p = RawProfile {
        id: attr(start, b"id").unwrap_or_default(),
        name: attr(start, b"name").unwrap_or_default(),
        type_name: attr(start, b"typeName").unwrap_or_default(),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"characteristics" => read_characteristics_into(&mut p.characteristics, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"profile" => return Ok(p),
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml("unexpected EOF in profile".to_string()))
            }
        }
    }
}

fn read_characteristics_into(
    dst: &mut Vec<RawCharacteristic>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"characteristic" => {
                    let name = attr(&e, b"name").unwrap_or_default();
                    let value = read_text_until(r, b"characteristic")?;
                    dst.push(RawCharacteristic { name, value });
                }
                Event::Empty(e) if e.local_name().as_ref() == b"characteristic" => {
                    dst.push(RawCharacteristic {
                        name: attr(&e, b"name").unwrap_or_default(),
                        value: String::new(),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"characteristics" => {
                    return Ok(())
                }
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in characteristics".to_string(),
                ))
            }
        }
    }
}

/// Collect text content until the matching end tag, unescaping XML entities.
fn read_text_until(r: &mut SafeXmlReader, end: &[u8]) -> Result<String, ParseError> {
    let mut out = String::new();
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Text(t) => {
                    let s = t
                        .unescape()
                        .map_err(|e| ParseError::MalformedXml(e.to_string()))?;
                    out.push_str(&s);
                }
                Event::End(e) if e.local_name().as_ref() == end => return Ok(out.trim().to_string()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml("unexpected EOF in text element".to_string()))
            }
        }
    }
}
```

Note: `attr`, `skip_element`, `BytesStart`, `Event` are already imported/used in `parse.rs`; add no new imports unless the compiler flags a missing one (e.g. `quick_xml::events::Event` is already in scope).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/engine-parser && cargo test --test raw_parse reads_profiles_with_characteristics`
Expected: PASS.

- [ ] **Step 6: Run the full parser suite (nothing else regressed)**

Run: `cd packages/engine-parser && cargo test`
Expected: all green (golden still passes — the fixture has no profiles yet, `read_entry` just never enters the new arm).

- [ ] **Step 7: Commit**

```bash
git add packages/engine-parser/src/raw/model.rs packages/engine-parser/src/raw/parse.rs packages/engine-parser/tests/raw_parse.rs
git commit -m "feat(parser): read <profiles>/<characteristics> into the raw model"
```

---

### Task 2: Rust IR layer — emit profiles + regenerate fixture/golden

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs`
- Modify: `packages/engine-parser/src/ir/map.rs`
- Modify: `packages/engine-parser/tests/fixtures/mini40k.cat`
- Modify (regenerate): `packages/engine-parser/tests/fixtures/mini40k.catz`, `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json`
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Consumes: `RawEntry.profiles` (Task 1).
- Produces: IR `IrProfile { name, type_name→"typeName", characteristics }`, `IrCharacteristic { name, value }`; `IrEntry.profiles: Vec<IrProfile>` (serialized key `profiles`, skipped when empty).

- [ ] **Step 1: Write the failing test**

Add to `packages/engine-parser/tests/map.rs`:

```rust
#[test]
fn maps_profiles_onto_ir_entries() {
    let (ir, _diags) = engine_parser::parse_bytes(
        include_bytes!("fixtures/mini40k.cat"),
        false,
    )
    .unwrap();
    let captain = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    let unit = captain.profiles.iter().find(|p| p.type_name == "Unit").unwrap();
    assert_eq!(unit.name, "Captain");
    let m = unit.characteristics.iter().find(|c| c.name == "M").unwrap();
    assert_eq!(m.value, "6\"");
    assert!(captain.profiles.iter().any(|p| p.type_name == "Abilities"));

    // the wargear weapon profile is on the flattened child entry
    let sword = captain.children.iter().find(|e| e.id == "e.captain.sword").unwrap();
    assert_eq!(sword.profiles[0].type_name, "Melee Weapons");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine-parser && cargo test --test map maps_profiles_onto_ir_entries`
Expected: FAIL to compile (`profiles` not on `IrEntry`) — then, once structs exist but fixture unchanged, FAIL on assertions.

- [ ] **Step 3: Add IR structs and field**

In `packages/engine-parser/src/ir/model.rs`, add `profiles` to `IrEntry` (after `groups`):
```rust
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<IrGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub profiles: Vec<IrProfile>,
}
```

Append the new structs:
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrProfile {
    pub name: String,
    pub type_name: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub characteristics: Vec<IrCharacteristic>,
}

#[derive(Debug, Serialize)]
pub struct IrCharacteristic {
    pub name: String,
    pub value: String,
}
```

- [ ] **Step 4: Map profiles in `map_entry`**

In `packages/engine-parser/src/ir/map.rs`, build profiles from `e.profiles` and set the field in the `IrEntry { … }` literal. Add before the `IrEntry {` construction (near where `children`/`groups` are built):
```rust
    let profiles: Vec<IrProfile> = e.profiles.iter().map(map_profile).collect();
```
Add `profiles,` to the `IrEntry { … }` literal (after `groups,`).

Add the helper. `map.rs` already has `use super::model::*;` so `IrProfile`/`IrCharacteristic` are in scope with NO new IR import. Add `RawProfile` to the existing `use crate::raw::{…}` list at the top (it currently imports `RawEntry`, `RawGroup`, etc. but not `RawProfile`):
```rust
fn map_profile(p: &RawProfile) -> IrProfile {
    IrProfile {
        name: p.name.clone(),
        type_name: p.type_name.clone(),
        characteristics: p
            .characteristics
            .iter()
            .map(|c| IrCharacteristic { name: c.name.clone(), value: c.value.clone() })
            .collect(),
    }
}
```

- [ ] **Step 5: Add profiles to the fixture `mini40k.cat`**

In `packages/engine-parser/tests/fixtures/mini40k.cat`:

Inside `<selectionEntry id="e.captain" …>`, immediately after the `<categoryLinks>…</categoryLinks>` line, insert:
```xml
      <profiles>
        <profile id="p.captain.unit" name="Captain" typeName="Unit">
          <characteristics>
            <characteristic name="M">6&quot;</characteristic>
            <characteristic name="T">4</characteristic>
            <characteristic name="SV">3+</characteristic>
            <characteristic name="W">5</characteristic>
            <characteristic name="LD">6+</characteristic>
            <characteristic name="OC">1</characteristic>
          </characteristics>
        </profile>
        <profile id="p.captain.ability" name="Rites of Battle" typeName="Abilities">
          <characteristics>
            <characteristic name="Description">Once per battle round, re-roll one Hit roll.</characteristic>
          </characteristics>
        </profile>
      </profiles>
```

Inside `<selectionEntry id="e.captain.sword" …>`, after its `<costs>…</costs>`, insert:
```xml
              <profiles>
                <profile id="p.sword" name="Power Sword" typeName="Melee Weapons">
                  <characteristics>
                    <characteristic name="Range">Melee</characteristic>
                    <characteristic name="A">5</characteristic>
                    <characteristic name="WS">2+</characteristic>
                    <characteristic name="S">5</characteristic>
                    <characteristic name="AP">-2</characteristic>
                    <characteristic name="D">1</characteristic>
                  </characteristics>
                </profile>
              </profiles>
```

Inside `<selectionEntry id="e.captain.axe" …>`, after its `<costs>…</costs>`, insert:
```xml
              <profiles>
                <profile id="p.axe" name="Power Axe" typeName="Melee Weapons">
                  <characteristics>
                    <characteristic name="Range">Melee</characteristic>
                    <characteristic name="A">4</characteristic>
                    <characteristic name="WS">3+</characteristic>
                    <characteristic name="S">6</characteristic>
                    <characteristic name="AP">-2</characteristic>
                    <characteristic name="D">2</characteristic>
                  </characteristics>
                </profile>
              </profiles>
```

Inside `<selectionEntry id="squad-body.model" …>`, after its `<categoryLinks>…</categoryLinks>`, insert:
```xml
          <profiles>
            <profile id="p.trooper.unit" name="Trooper" typeName="Unit">
              <characteristics>
                <characteristic name="M">6&quot;</characteristic>
                <characteristic name="T">4</characteristic>
                <characteristic name="SV">3+</characteristic>
                <characteristic name="W">2</characteristic>
                <characteristic name="LD">6+</characteristic>
                <characteristic name="OC">2</characteristic>
              </characteristics>
            </profile>
          </profiles>
```

- [ ] **Step 6: Regenerate the golden JSON**

Create `packages/engine-parser/examples/dump_ir.rs`:
```rust
fn main() {
    let (ir, _) = engine_parser::parse_bytes(
        include_bytes!("../tests/fixtures/mini40k.cat"),
        false,
    )
    .unwrap();
    println!("{}", serde_json::to_string_pretty(&ir).unwrap());
}
```
Run:
```bash
cd packages/engine-parser
cargo run --example dump_ir > tests/fixtures/golden/mini40k.ir.json
rm examples/dump_ir.rs
rmdir examples 2>/dev/null || true
```

- [ ] **Step 7: Regenerate the `.catz` zip**

```bash
cd packages/engine-parser/tests/fixtures
rm -f mini40k.catz
zip -X mini40k.catz mini40k.cat
cd -
```

- [ ] **Step 8: Run parser suite (map test + golden + zip-identity all green)**

Run: `cd packages/engine-parser && cargo test`
Expected: all green — `maps_profiles_onto_ir_entries` passes, `parser_output_matches_golden` passes against the regenerated golden, `parses_the_zip_form_identically` passes against the regenerated `.catz`.

- [ ] **Step 9: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs \
        packages/engine-parser/tests/map.rs \
        packages/engine-parser/tests/fixtures/mini40k.cat \
        packages/engine-parser/tests/fixtures/mini40k.catz \
        packages/engine-parser/tests/fixtures/golden/mini40k.ir.json
git commit -m "feat(parser): emit IrEntry.profiles; add profiles to mini40k fixture + golden"
```

---

### Task 3: Domain — Zod `IrProfile` / `IrCharacteristic`

**Files:**
- Modify: `packages/domain/src/ir.ts`
- Test: `packages/domain/test/ir.test.ts`

**Interfaces:**
- Produces: `IrProfile` (`{ name: string; typeName: string; characteristics: {name,value}[] }`), `IrCharacteristic`; `IrEntry.profiles: IrProfile[]` (defaults `[]`).

- [ ] **Step 1: Write the failing test**

Add to `packages/domain/test/ir.test.ts`:
```ts
it("parses an entry carrying profiles", () => {
  const entry = IrEntry.parse({
    id: "e.hero", name: "Hero",
    profiles: [{
      name: "Hero", typeName: "Unit",
      characteristics: [{ name: "M", value: '6"' }, { name: "T", value: "4" }],
    }],
  });
  expect(entry.profiles[0]?.typeName).toBe("Unit");
  expect(entry.profiles[0]?.characteristics[1]?.value).toBe("4");
});

it("defaults profiles to an empty array when absent", () => {
  const entry = IrEntry.parse({ id: "e.bare", name: "Bare" });
  expect(entry.profiles).toEqual([]);
});
```
(Ensure `IrEntry` is imported in this test file — it already is if other `IrEntry.parse` tests exist; otherwise add it to the import from `../src/ir`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test -- ir.test`
Expected: FAIL (`profiles` is stripped / undefined; `entry.profiles` is `undefined`, `.toEqual([])` fails).

- [ ] **Step 3: Add the schemas and field**

In `packages/domain/src/ir.ts`, add before `IrEntry`:
```ts
export const IrCharacteristic = z.object({ name: z.string(), value: z.string() });
export type IrCharacteristic = z.infer<typeof IrCharacteristic>;

export const IrProfile = z.object({
  name: z.string(),
  typeName: z.string(),
  characteristics: z.array(IrCharacteristic).default([]),
});
export type IrProfile = z.infer<typeof IrProfile>;
```

Add `profiles` to the `IrEntry` interface:
```ts
  groups?: IrGroup[];
  profiles: IrProfile[];
}
```
And to the lazy schema object (after `groups: z.array(IrGroup).default([]),`):
```ts
    profiles: z.array(IrProfile).default([]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test -- ir.test`
Expected: PASS.

- [ ] **Step 5: Run full domain suite (100% coverage holds)**

Run: `pnpm --filter @muster/domain test`
Expected: all green at 100% coverage.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): IrProfile/IrCharacteristic schemas + IrEntry.profiles"
```

---

### Task 4: `@muster/roster` — `datasheet()` aggregation

**Files:**
- Modify: `packages/roster/src/builder.ts`
- Test: `packages/roster/test/datasheet.test.ts` (create)

Note: `packages/roster/src/index.ts` is `export * from "./builder";` — new exports flow through automatically, no barrel edit needed.

**Interfaces:**
- Consumes: `IrProfile` from `@muster/domain` (Task 3); `catalogueEntry`, `RosterSelection`.
- Produces: `interface DatasheetSection { typeName: string; profiles: IrProfile[] }`; `datasheet(catalogue: IrCatalogue, selection: RosterSelection): DatasheetSection[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/roster/test/datasheet.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { datasheet } from "../src";

const unit = (over: Partial<IrCatalogue["entries"][number]>) => ({
  id: "x", name: "X", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [], ...over,
});

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [
    unit({
      id: "e.hero", name: "Hero",
      profiles: [
        { name: "Hero", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] },
        { name: "Aura", typeName: "Abilities", characteristics: [{ name: "Description", value: "buff" }] },
      ],
      children: [
        unit({ id: "e.sword", name: "Sword",
          profiles: [{ name: "Sword", typeName: "Melee Weapons", characteristics: [{ name: "A", value: "5" }] }] }),
      ],
    }),
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count: 1, selections: children,
});

describe("datasheet", () => {
  it("returns empty for a selection whose entry has no profiles and no chosen children", () => {
    const bare = { ...cat, entries: [unit({ id: "e.bare", name: "Bare" })] } as unknown as IrCatalogue;
    expect(datasheet(bare, sel("e.bare"))).toEqual([]);
  });

  it("groups the unit's own profiles by typeName in first-seen order", () => {
    const out = datasheet(cat, sel("e.hero"));
    expect(out.map((s) => s.typeName)).toEqual(["Unit", "Abilities"]);
    expect(out[0]?.profiles[0]?.characteristics[0]?.value).toBe('6"');
  });

  it("aggregates weapon profiles from selected children into their own section", () => {
    const out = datasheet(cat, sel("e.hero", [sel("e.sword")]));
    const melee = out.find((s) => s.typeName === "Melee Weapons");
    expect(melee?.profiles.map((p) => p.name)).toEqual(["Sword"]);
  });

  it("does not include a child's weapon when that child is not selected", () => {
    const out = datasheet(cat, sel("e.hero"));
    expect(out.some((s) => s.typeName === "Melee Weapons")).toBe(false);
  });

  it("de-duplicates an identical profile shared by two selected models", () => {
    const out = datasheet(cat, sel("e.hero", [sel("e.sword"), sel("e.sword")]));
    const melee = out.find((s) => s.typeName === "Melee Weapons");
    expect(melee?.profiles).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/roster test -- datasheet`
Expected: FAIL (`datasheet` is not exported).

- [ ] **Step 3: Implement `datasheet` in `builder.ts`**

Add to `packages/roster/src/builder.ts` (import `IrProfile` in the existing type import from `@muster/domain`):
```ts
/** A datasheet section: all profiles of one typeName across the selected subtree. */
export interface DatasheetSection {
  typeName: string;
  profiles: IrProfile[];
}

/**
 * The live datasheet for a unit selection: every profile found on the unit's own
 * entry and on the entries of its selected descendants, grouped by `typeName` in
 * first-seen order. Profiles identical in name+typeName+characteristics collapse to
 * one (two identical weapons from two models show a single row).
 */
export function datasheet(catalogue: IrCatalogue, selection: RosterSelection): DatasheetSection[] {
  const sections: DatasheetSection[] = [];
  const byType = new Map<string, DatasheetSection>();
  const seen = new Set<string>();

  const visit = (sel: RosterSelection): void => {
    const entry = catalogueEntry(catalogue, sel.entryId);
    for (const profile of entry?.profiles ?? []) {
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
    for (const child of sel.selections) visit(child);
  };

  visit(selection);
  return sections;
}

function profileKey(p: IrProfile): string {
  const chars = p.characteristics.map((c) => `${c.name}=${c.value}`).join("|");
  return `${p.typeName} ${p.name} ${chars}`;
}
```

- [ ] **Step 4: Run test to verify it passes + coverage holds**

Run: `pnpm --filter @muster/roster test`
Expected: all green; `builder.ts` remains at 100% coverage (the new branches are all exercised: empty, own-profiles, child aggregation, unselected-exclusion, dedup).

- [ ] **Step 5: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/index.ts packages/roster/test/datasheet.test.ts
git commit -m "feat(roster): datasheet() aggregates subtree profiles grouped by typeName"
```

---

### Task 5: Web — `Datasheet` component + demo catalogue profiles

**Files:**
- Create: `apps/web/src/components/Datasheet.tsx`
- Modify: `apps/web/src/components/RosterPanel.tsx` (render datasheet under each root unit)
- Modify: `apps/web/src/mini40k.ir.json` (add profiles so the demo shows datasheets)
- Modify: `apps/web/src/index.css` (datasheet styles)
- Test: `apps/web/src/components/Datasheet.test.tsx` (create)

**Interfaces:**
- Consumes: `datasheet`, `DatasheetSection` from `@muster/roster` (Task 4); `IrCatalogue`, `RosterSelection` from `@muster/domain`.

- [ ] **Step 1: Add profiles to the demo catalogue**

In `apps/web/src/mini40k.ir.json`, add a `"profiles"` array to the relevant entries so the datasheet renders. Add to the Captain entry (id `e.captain`):
```json
"profiles": [
  { "name": "Captain", "typeName": "Unit", "characteristics": [
    { "name": "M", "value": "6\"" }, { "name": "T", "value": "4" }, { "name": "SV", "value": "3+" },
    { "name": "W", "value": "5" }, { "name": "LD", "value": "6+" }, { "name": "OC", "value": "1" } ] },
  { "name": "Rites of Battle", "typeName": "Abilities", "characteristics": [
    { "name": "Description", "value": "Once per battle round, re-roll one Hit roll." } ] }
]
```
Add to `e.captain.sword`:
```json
"profiles": [ { "name": "Power Sword", "typeName": "Melee Weapons", "characteristics": [
  { "name": "Range", "value": "Melee" }, { "name": "A", "value": "5" }, { "name": "WS", "value": "2+" },
  { "name": "S", "value": "5" }, { "name": "AP", "value": "-2" }, { "name": "D", "value": "1" } ] } ]
```
Add to `e.captain.axe`:
```json
"profiles": [ { "name": "Power Axe", "typeName": "Melee Weapons", "characteristics": [
  { "name": "Range", "value": "Melee" }, { "name": "A", "value": "4" }, { "name": "WS", "value": "3+" },
  { "name": "S", "value": "6" }, { "name": "AP", "value": "-2" }, { "name": "D", "value": "2" } ] } ]
```
(If entries `e.assault.marine` / assault weapons exist in this file, adding analogous profiles is welcome but optional — the Captain path is what the test asserts. Insert each `"profiles"` key as a sibling of the entry's existing `"name"`/`"costs"` keys; keep the JSON valid.)

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/Datasheet.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { Datasheet } from "./Datasheet";

const cat = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [
    { id: "e.hero", name: "Hero", costs: [], categories: ["Infantry"], constraints: [], children: [
        { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [],
          profiles: [{ name: "Sword", typeName: "Melee Weapons",
            characteristics: [{ name: "A", value: "5" }, { name: "S", value: "5" }] }] },
      ], groups: [],
      profiles: [{ name: "Hero", typeName: "Unit",
        characteristics: [{ name: "M", value: '6"' }, { name: "T", value: "4" }] }] },
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count: 1, selections: children,
});

describe("Datasheet", () => {
  it("renders the unit statline characteristics", () => {
    render(<Datasheet catalogue={cat} selection={sel("e.hero")} />);
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText('6"')).toBeInTheDocument();
  });

  it("shows a weapon row only when the weapon is selected", () => {
    const { rerender } = render(<Datasheet catalogue={cat} selection={sel("e.hero")} />);
    expect(screen.queryByText("Sword")).not.toBeInTheDocument();
    rerender(<Datasheet catalogue={cat} selection={sel("e.hero", [sel("e.sword")])} />);
    expect(screen.getByText("Sword")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `pnpm --filter @muster/web test -- Datasheet`
Expected: FAIL (`./Datasheet` module not found).

- [ ] **Step 3: Implement the `Datasheet` component**

Create `apps/web/src/components/Datasheet.tsx`:
```tsx
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { datasheet, type DatasheetSection } from "@muster/roster";

/** Statline profiles (Unit) render as a row of labelled chips. */
function Statline({ section }: { section: DatasheetSection }) {
  const profile = section.profiles[0];
  if (!profile) return null;
  return (
    <div className="ds-statline">
      {profile.characteristics.map((c) => (
        <div key={c.name} className="ds-chip">
          <span className="ds-chip-label">{c.name}</span>
          <span className="ds-chip-value">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Weapons and other multi-column profiles render as a table. */
function ProfileTable({ section }: { section: DatasheetSection }) {
  const columns = section.profiles[0]?.characteristics.map((c) => c.name) ?? [];
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>{section.typeName}</th>
            {columns.map((name) => <th key={name}>{name}</th>)}
          </tr>
        </thead>
        <tbody>
          {section.profiles.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              {p.characteristics.map((c) => <td key={c.name}>{c.value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Abilities render as name + description blocks. */
function Abilities({ section }: { section: DatasheetSection }) {
  return (
    <div className="ds-abilities">
      {section.profiles.map((p) => (
        <p key={p.name}>
          <strong>{p.name}.</strong>{" "}
          {p.characteristics.find((c) => c.name === "Description")?.value ?? ""}
        </p>
      ))}
    </div>
  );
}

export function Datasheet({
  catalogue, selection,
}: {
  catalogue: IrCatalogue;
  selection: RosterSelection;
}) {
  const sections = datasheet(catalogue, selection);
  if (sections.length === 0) return null;
  return (
    <div className="ds" data-testid="datasheet">
      {sections.map((section) => {
        if (section.typeName === "Unit") return <Statline key={section.typeName} section={section} />;
        if (section.typeName === "Abilities") return <Abilities key={section.typeName} section={section} />;
        return <ProfileTable key={section.typeName} section={section} />;
      })}
    </div>
  );
}
```

- [ ] **Step 4: Render the datasheet under each root unit**

In `apps/web/src/components/RosterPanel.tsx`, import the component:
```tsx
import { Datasheet } from "./Datasheet";
```
Inside `SelectionNode`, render the datasheet for top-level units only (`depth === 0`), right after the `<UnitConfig … />` element:
```tsx
      {depth === 0 && <Datasheet catalogue={catalogue} selection={selection} />}
```

- [ ] **Step 5: Add datasheet styles**

Append to `apps/web/src/index.css`:
```css
.ds { margin-top: 8px; display: flex; flex-direction: column; gap: 10px; }
.ds-statline { display: flex; flex-wrap: wrap; gap: 6px; }
.ds-chip { display: flex; flex-direction: column; align-items: center; min-width: 42px;
  border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.ds-chip-label { font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
.ds-chip-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.ds-table-wrap { overflow-x: auto; }
.ds-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.ds-table th, .ds-table td { border: 1px solid var(--line); padding: 3px 8px; text-align: left;
  font-variant-numeric: tabular-nums; }
.ds-table th { opacity: 0.8; font-weight: 600; }
.ds-abilities p { margin: 2px 0; font-size: 13px; }
```
(If `--line` is not defined in this file, use an existing border token from `index.css`.)

- [ ] **Step 6: Run web tests**

Run: `pnpm --filter @muster/web test`
Expected: all green (Datasheet test + pre-existing tests).

- [ ] **Step 7: Full monorepo green**

Run: `pnpm -w test`
Expected: turbo all-successful.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/Datasheet.tsx apps/web/src/components/Datasheet.test.tsx \
        apps/web/src/components/RosterPanel.tsx apps/web/src/mini40k.ir.json apps/web/src/index.css
git commit -m "feat(web): render live Datasheet (statline/weapons/abilities) per unit"
```

---

## Self-Review notes

- **Spec coverage:** raw parse (T1), IR emit + fixture/golden (T2), domain schema (T3), roster aggregation (T4), web render + demo data (T5). Keywords deferred per spec (T5 optional). All spec layers covered.
- **Type consistency:** `type_name`→`typeName` (Rust serde) → `typeName` (Zod) → `DatasheetSection.typeName` → component switch on `"Unit"`/`"Abilities"`. `IrProfile.characteristics: {name,value}[]` consistent across Rust/Zod/roster/web. `datasheet(catalogue, selection)` signature identical in T4 producer and T5 consumer.
- **Fixture/golden hazard:** T2 explicitly regenerates BOTH `mini40k.ir.json` (golden) and `mini40k.catz` (zip form) — the golden suite asserts both.
- **Coverage hazard:** T4 logic lives in `builder.ts` (not `index.ts`), tests exercise every branch (empty/own/child/dedup) for 100%.
