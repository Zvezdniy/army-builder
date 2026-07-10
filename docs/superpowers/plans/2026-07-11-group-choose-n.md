# План реализации: группы choose-N (лимиты выбора)

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНАЯ ПОД-СКИЛЛ: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для выполнения плана задача-за-задачей. Шаги отмечены чекбоксами (`- [ ]`).

**Цель:** Проверять BattleScribe-лимиты `<selectionEntryGroup>` типа choose-N по количеству (min/max выбранных участников) через отдельный узел `IrGroup` — сейчас они молча теряются, и нелегальная сборка проходит как валидная.

**Архитектура:** Новый узел `IrGroup` живёт на `IrEntry`. Парсер (Rust) при маппинге сохраняет участников группы (их id) и её лимиты min/max, вместо того чтобы отбрасывать. Движок (`engine-eval`) отдельным проходом агрегирует прямых детей юнита-владельца по членству в группе и сверяет с min/max. Всё вне рамок — громкая диагностика + drop.

**Стек:** pnpm workspaces + Turborepo; `@muster/domain` (Zod, TS); `@muster/engine-eval` (чистый TS, Vitest); `packages/engine-parser` (Rust, serde, quick-xml).

## Глобальные ограничения

Требования всего проекта, неявно входят в каждую задачу:

- **Никогда не считать неправильно.** Что не представимо точно — диагностика `group.constraint_dropped` + drop, никогда не угаданное значение.
- **Недоверенный вход.** Все новые числовые IR-поля — `z.number().finite()`. Парсер не добавляет `unsafe` (крейт остаётся `#![forbid(unsafe_code)]`).
- **Контракт синхронен.** Golden парсера `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json` и его копия `packages/engine-eval/test/fixtures/parser-golden.ir.json` обновляются вместе и остаются байт-в-байт идентичными.
- **Покрытие.** Принудительные пороги 100% (statements/branches/functions/lines) на `@muster/domain` и `@muster/engine-eval` держать зелёными. Финальные гейты: `pnpm typecheck`, `pnpm test`, `cargo test`, `cargo deny check`, `cargo audit` — все чистые.
- **Рамки.** Только `field=selections`, `type` ∈ {min, max}. Вне рамок (лимит по очкам, модификатор на лимите, вложенные под-группы) — диагностика-drop.

**Команды для точечного прогона (без coverage-порогов во время red/green):**
- domain: `pnpm --filter @muster/domain exec vitest run <файл> --coverage=false`
- engine-eval: `pnpm --filter @muster/engine-eval exec vitest run <файл> --coverage=false`
- parser: `cd packages/engine-parser && cargo test --test <имя>`

---

## Задача 1: domain — тип `IrGroup`/`IrGroupConstraint` + поле `IrEntry.groups`

**Файлы:**
- Изменить: `packages/domain/src/ir.ts`
- Тест: `packages/domain/test/ir.test.ts`

**Интерфейсы:**
- Производит: `IrGroupConstraint = { id: string; type: "min"|"max"; value: number }`, `IrGroup = { id: string; name: string; memberEntryIds: string[]; constraints: IrGroupConstraint[] }`, и новое поле `IrEntry.groups: IrGroup[]` (default `[]`). Используется парсером (зеркалит форму) и `engine-eval` (Задачи 3–4).

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `packages/domain/test/ir.test.ts`:

```ts
import { IrGroup, IrGroupConstraint, IrEntry } from "../src/ir";

describe("IrGroup / IrGroupConstraint", () => {
  it("parses a group with min/max constraints and members", () => {
    const g = IrGroup.parse({
      id: "g.wargear", name: "Wargear",
      memberEntryIds: ["e.sword", "e.axe"],
      constraints: [{ id: "g.max", type: "max", value: 1 }],
    });
    expect(g.memberEntryIds).toEqual(["e.sword", "e.axe"]);
    expect(g.constraints[0]).toEqual({ id: "g.max", type: "max", value: 1 });
  });

  it("defaults memberEntryIds and constraints to empty arrays", () => {
    const g = IrGroup.parse({ id: "g", name: "G" });
    expect(g.memberEntryIds).toEqual([]);
    expect(g.constraints).toEqual([]);
  });

  it("defaults IrEntry.groups to empty array when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.groups).toEqual([]);
  });

  it("rejects a non-finite constraint value", () => {
    expect(IrGroupConstraint.safeParse({ id: "g", type: "max", value: Infinity }).success).toBe(false);
  });

  it("rejects an unknown constraint type", () => {
    expect(IrGroupConstraint.safeParse({ id: "g", type: "exactly", value: 1 }).success).toBe(false);
  });
});
```

- [ ] **Шаг 2: Прогнать тест — убедиться, что падает**

Запуск: `pnpm --filter @muster/domain exec vitest run test/ir.test.ts --coverage=false`
Ожидается: FAIL (нет экспортов `IrGroup`/`IrGroupConstraint`, у `IrEntry` нет `groups`).

- [ ] **Шаг 3: Реализация**

В `packages/domain/src/ir.ts` добавить после блока `IrConstraint` (перед `interface IrEntry`):

```ts
export const IrGroupConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number().finite(),
});
export type IrGroupConstraint = z.infer<typeof IrGroupConstraint>;

export const IrGroup = z.object({
  id: z.string(),
  name: z.string(),
  memberEntryIds: z.array(z.string()).default([]),
  constraints: z.array(IrGroupConstraint).default([]),
});
export type IrGroup = z.infer<typeof IrGroup>;
```

В `interface IrEntry` добавить поле **опциональным** (важно — см. ниже):

```ts
  groups?: IrGroup[];
```

В lazy-схеме `IrEntry` (внутри `z.object({ ... })`) добавить:

```ts
    groups: z.array(IrGroup).default([]),
```

**Почему `groups?` опционально в интерфейсе (не менять на обязательное):** Zod
`.default([])` делает поле всегда присутствующим в *распарсенном* IR, но по
кодовой базе ~17 тест-файлов `engine-eval` строят `IrEntry`-литералы вручную без
`groups`. Обязательное поле сломало бы typecheck во всех них — несвязанный
массовый churn. Опциональное поле не трогает существующие литералы; движок
читает его через `?? []` (Задача 3). Это осознанный компромисс по blast radius,
не недосмотр.

- [ ] **Шаг 4: Прогнать тест — убедиться, что проходит**

Запуск: `pnpm --filter @muster/domain exec vitest run test/ir.test.ts --coverage=false`
Ожидается: PASS.

- [ ] **Шаг 5: Полный прогон пакета с покрытием**

Запуск: `pnpm --filter @muster/domain test`
Ожидается: все тесты зелёные, покрытие 100%.

- [ ] **Шаг 6: Коммит**

```bash
git add packages/domain/src/ir.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): IrGroup/IrGroupConstraint + IrEntry.groups for choose-N"
```

---

## Задача 2: engine-parser — эмиссия `IrGroup` при маппинге

**Файлы:**
- Изменить: `packages/engine-parser/src/ir/model.rs` (serde-структуры)
- Изменить: `packages/engine-parser/src/raw/model.rs` (`RawGroup.modifiers`)
- Изменить: `packages/engine-parser/src/raw/parse.rs` (`read_group` читает `<modifiers>`)
- Изменить: `packages/engine-parser/src/ir/map.rs` (маппинг групп)
- Изменить: `packages/engine-parser/tests/fixtures/mini40k.cat` (второй участник группы)
- Изменить (бинарно): `packages/engine-parser/tests/fixtures/mini40k.catz` (перегенерировать)
- Изменить: `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json` (у капитана появляется `groups`)
- Изменить: `packages/engine-parser/tests/map.rs` (тесты)
- Изменить: `packages/engine-parser/tests/raw_parse.rs` (модификаторы группы фиксируются — при необходимости)

**Интерфейсы:**
- Потребляет: разрешённый `RawCatalogue` (после `resolve()`; `resolve_group` инлайнит entryLinks групп в `g.entries`, links.rs:87–98 — поэтому `g.entries` содержит всех прямых участников).
- Производит: у `IrEntry` заполняется `groups: Vec<IrGroup>` для групп с ≥1 пригодным лимитом min/max по selections; участники по-прежнему «расплющены» в `children`.

- [ ] **Шаг 1: Написать падающие тесты**

Заменить в `packages/engine-parser/tests/map.rs` тест `maps_group_member_entries_and_diagnoses_group_constraint` на следующие два и добавить третий:

```rust
#[test]
fn maps_group_choose_n_and_flattens_members() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    // members are still flattened into children
    assert!(cap.children.iter().any(|c| c.id == "e.captain.sword"));
    assert!(cap.children.iter().any(|c| c.id == "e.captain.axe"));
    // the group's choose-max-1 is now preserved as an IrGroup, not dropped
    let g = cap.groups.iter().find(|g| g.id == "g.wargear").unwrap();
    assert_eq!(g.name, "Wargear");
    assert_eq!(g.member_entry_ids, vec!["e.captain.sword", "e.captain.axe"]);
    assert_eq!(g.constraints.len(), 1);
    assert_eq!((g.constraints[0].id.as_str(), g.constraints[0].type_.as_str(), g.constraints[0].value),
               ("g.wargear.max", "max", 1.0));
    // fixture is fully mappable now — no group drop diagnostics
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected: {:?}", diags);
}

#[test]
fn drops_group_points_and_modifier_and_nested_constraints() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.pts" name="Pts">
          <constraints><constraint id="g.pts.max" type="max" value="30" field="pts" scope="parent"/></constraints>
          <selectionEntries><selectionEntry id="e.a" name="A" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
        <selectionEntryGroup id="g.mod" name="Mod">
          <constraints><constraint id="g.mod.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers><modifier type="increment" field="g.mod.max" value="1"/></modifiers>
          <selectionEntries><selectionEntry id="e.b" name="B" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
        <selectionEntryGroup id="g.outer" name="Outer">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.inner" name="Inner">
              <constraints><constraint id="g.inner.max" type="max" value="1" field="selections" scope="parent"/></constraints>
              <selectionEntries><selectionEntry id="e.c" name="C" type="upgrade"/></selectionEntries>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // points-field group, modifier-on-limit group, and nested-group constraint are all dropped → no IrGroup emitted
    assert!(u.groups.is_empty(), "no group should be emitted: {:?}", u.groups);
    // members still flattened
    for id in ["e.a", "e.b", "e.c"] {
        assert!(u.children.iter().any(|c| c.id == id), "member {} lost", id);
    }
    // three loud drop diagnostics (points, modifier-on-limit, nested)
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 3, "{:?}", diags);
}

#[test]
fn min_and_max_group_constraints_both_map() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Loadout">
          <constraints>
            <constraint id="g.min" type="min" value="1" field="selections" scope="parent"/>
            <constraint id="g.max" type="max" value="2" field="selections" scope="parent"/>
          </constraints>
          <selectionEntries>
            <selectionEntry id="e.x" name="X" type="upgrade"/>
            <selectionEntry id="e.y" name="Y" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let g = ir.entries[0].groups.iter().find(|g| g.id == "g").unwrap();
    assert_eq!(g.constraints.len(), 2);
    assert!(g.constraints.iter().any(|c| c.type_ == "min" && c.value == 1.0));
    assert!(g.constraints.iter().any(|c| c.type_ == "max" && c.value == 2.0));
}
```

- [ ] **Шаг 2: Прогнать тесты — убедиться, что падают**

Запуск: `cd packages/engine-parser && cargo test --test map`
Ожидается: не компилируется / FAIL (у `IrEntry` нет `groups`, `RawGroup` не читает modifiers).

- [ ] **Шаг 3: serde-структуры IR (`src/ir/model.rs`)**

Добавить после структуры `IrCost` (или рядом с `IrConstraint`):

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrGroup {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub member_entry_ids: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<IrGroupConstraint>,
}

#[derive(Debug, Serialize)]
pub struct IrGroupConstraint {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
}
```

В структуру `IrEntry` добавить поле (последним):

```rust
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<IrGroup>,
```

- [ ] **Шаг 4: `RawGroup.modifiers` + чтение `<modifiers>` группы**

В `src/raw/model.rs`, в структуру `RawGroup` добавить поле:

```rust
    pub modifiers: Vec<RawModifier>,
```

(итог: `pub struct RawGroup { pub id: String, pub name: String, pub entries: Vec<RawEntry>, pub groups: Vec<RawGroup>, pub entry_links: Vec<RawEntryLink>, pub constraints: Vec<RawConstraint>, pub modifiers: Vec<RawModifier> }`)

В `src/raw/parse.rs`, в `read_group`, заменить строку
`b"modifiers" => skip_element(r, b"modifiers")?,` на:

```rust
                    b"modifiers" => read_modifiers_into(&mut group.modifiers, r)?,
```

- [ ] **Шаг 5: Маппинг групп (`src/ir/map.rs`)**

В начале файла к списку импортов из `crate::raw` уже входят `RawGroup`, `RawConstraint`, `RawModifier` (проверить; добавить недостающие). Заменить функцию `collect_group_entries` на три функции ниже:

```rust
/// Flatten a group's member entries (recursing sub-groups) into `out`; members
/// nested under a group are direct children of the owning entry in the IR.
fn flatten_group_members(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrEntry>) {
    for child in &g.entries {
        out.push(map_entry(child, cat, diags));
    }
    for sub in &g.groups {
        flatten_group_members(sub, cat, diags, out);
    }
}

/// Map a group's own choose-N (selections min/max) into an IrGroup. Nested
/// sub-group constraints are out of scope and diagnostic-dropped. Returns None
/// when the group has no mappable min/max selections limit (behaviour then
/// matches the pre-feature drop: members flattened, no IrGroup emitted).
fn map_group(g: &RawGroup, diags: &mut Vec<Diagnostic>) -> Option<IrGroup> {
    for sub in &g.groups {
        drop_group_constraints(sub, diags);
    }
    let member_entry_ids: Vec<String> = g.entries.iter().map(|e| e.id.clone()).collect();
    let mut constraints: Vec<IrGroupConstraint> = Vec::new();
    for c in &g.constraints {
        if let Some(gc) = map_group_constraint(c, g, diags) {
            constraints.push(gc);
        }
    }
    if constraints.is_empty() {
        return None;
    }
    Some(IrGroup { id: g.id.clone(), name: g.name.clone(), member_entry_ids, constraints })
}

/// A group choose-N limit maps only when it is a selections min/max with no
/// modifier on the limit itself (a conditional limit we cannot yet model).
/// Anything else is a loud drop — never a guessed static value.
fn map_group_constraint(c: &RawConstraint, g: &RawGroup, diags: &mut Vec<Diagnostic>) -> Option<IrGroupConstraint> {
    let drop = |why: String| Diagnostic {
        code: "group.constraint_dropped".to_string(),
        message: format!("selectionEntryGroup {} constraint {} {} (dropped)", g.id, c.id, why),
    };
    if c.kind != "min" && c.kind != "max" {
        diags.push(drop(format!("has unsupported type {}", c.kind)));
        return None;
    }
    if c.field != "selections" {
        diags.push(drop(format!("is not on selections (field {})", c.field)));
        return None;
    }
    if g.modifiers.iter().any(|m| m.field == c.id) {
        diags.push(drop("has a modifier on its limit".to_string()));
        return None;
    }
    Some(IrGroupConstraint { id: c.id.clone(), type_: c.kind.clone(), value: c.value })
}

/// Loudly drop every constraint of a nested sub-group (choose-N on nested groups
/// is out of scope), recursing so no nested limit is silently lost.
fn drop_group_constraints(g: &RawGroup, diags: &mut Vec<Diagnostic>) {
    for gc in &g.constraints {
        diags.push(Diagnostic {
            code: "group.constraint_dropped".to_string(),
            message: format!("nested selectionEntryGroup {} constraint {} has no IR representation (dropped)", g.id, gc.id),
        });
    }
    for sub in &g.groups {
        drop_group_constraints(sub, diags);
    }
}
```

В `map_entry` заменить блок построения `children`/`IrEntry` на:

```rust
    let mut children: Vec<IrEntry> = e.entries.iter().map(|c| map_entry(c, cat, diags)).collect();
    let mut groups: Vec<IrGroup> = Vec::new();
    for g in &e.groups {
        flatten_group_members(g, cat, diags, &mut children);
        if let Some(ir_group) = map_group(g, diags) {
            groups.push(ir_group);
        }
    }

    IrEntry {
        id: e.id.clone(),
        name: e.name.clone(),
        costs,
        categories: e.category_links.iter().map(|l| l.target_id.clone()).collect(),
        constraints,
        children,
        groups,
    }
```

- [ ] **Шаг 6: Прогнать новые тесты маппинга (кроме golden)**

Запуск: `cd packages/engine-parser && cargo test --test map`
Ожидается: PASS (3 новых теста зелёные; старые в map.rs зелёные).

- [ ] **Шаг 7: Обновить фикстуру — второй участник группы**

В `packages/engine-parser/tests/fixtures/mini40k.cat`, в группе `g.wargear`, после участника `e.captain.sword` добавить:

```xml
            <selectionEntry id="e.captain.axe" name="Power Axe" type="upgrade">
              <costs><cost name="Points" typeId="pts" value="10"/></costs>
            </selectionEntry>
```

- [ ] **Шаг 8: Перегенерировать `mini40k.catz`**

```bash
cd packages/engine-parser/tests/fixtures && rm -f mini40k.catz && zip -q -X mini40k.catz mini40k.cat
```

- [ ] **Шаг 9: Обновить golden**

Обновить `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json`: у объекта `e.captain` теперь два ребёнка (`e.captain.sword` value 5.0, `e.captain.axe` value 10.0) и новый ключ `groups`:

```json
      "groups": [
        {
          "id": "g.wargear",
          "name": "Wargear",
          "memberEntryIds": ["e.captain.sword", "e.captain.axe"],
          "constraints": [{ "id": "g.wargear.max", "type": "max", "value": 1.0 }]
        }
      ]
```

Проще всего сгенерировать точную форму и вставить:
`cd packages/engine-parser && cargo run --quiet --bin muster-parse -- tests/fixtures/mini40k.cat` — взять поле `entries[e.captain]` из вывода, привести файл в соответствие, затем `cargo test --test golden` для сверки.

- [ ] **Шаг 10: Полный прогон крейта**

Запуск: `cd packages/engine-parser && cargo test`
Ожидается: все тесты зелёные (`golden`, `map`, `raw_parse`, `resolve`, proptest и т.д.).

- [ ] **Шаг 11: Гейты крейта**

Запуск: `cd packages/engine-parser && cargo clippy --all-targets -- -D warnings -A clippy::single_match -A clippy::while_let_loop && cargo deny check && cargo audit`
Ожидается: clippy по изменённым файлам чисто (две пре-существующие lint-подавлены), deny/audit ok.

- [ ] **Шаг 12: Коммит**

```bash
git add packages/engine-parser/src packages/engine-parser/tests
git commit -m "feat(parser): map selectionEntryGroup choose-N (selections min/max) to IrGroup"
```

---

## Задача 3: engine-eval — проверка лимитов групп

**Файлы:**
- Создать: `packages/engine-eval/src/groups.ts`
- Изменить: `packages/engine-eval/src/evaluate.ts` (добавить проход по группам)
- Тест: `packages/engine-eval/test/groups.test.ts`

**Интерфейсы:**
- Потребляет: `IrGroup`, `IrGroupConstraint`, `Issue` из `@muster/domain`; `EvalNode` из `./state`.
- Производит: `checkGroupConstraint(gc: IrGroupConstraint, node: EvalNode, group: IrGroup): Issue | null`. Вызывается из `evaluate()`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `packages/engine-eval/test/groups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// Captain with a Wargear group: choose at most 1 of {sword, axe}.
function cat(gcType: "max" | "min", value: number): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
        categories: ["cat.hq"], constraints: [], children: [
          { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
        ],
        groups: [{
          id: "g.wargear", name: "Wargear",
          memberEntryIds: ["e.sword", "e.axe"],
          constraints: [{ id: "g.wargear.limit", type: gcType, value }],
        }],
      },
      { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
      { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
    ],
  };
}

function roster(members: string[], overrides?: Roster["overrides"]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "cap", entryId: "e.captain", count: 1,
      selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })),
    }],
    overrides,
  };
}

describe("group choose-N constraints", () => {
  it("choose-max satisfied (1 selected, max 1) → valid", () => {
    const r = evaluate(roster(["e.sword"]), cat("max", 1));
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.constraintId === "g.wargear.limit")).toBe(false);
  });

  it("choose-max violated (2 selected, max 1) → group.max error naming the group", () => {
    const r = evaluate(roster(["e.sword", "e.axe"]), cat("max", 1));
    expect(r.valid).toBe(false);
    const issue = r.issues.find((i) => i.constraintId === "g.wargear.limit");
    expect(issue?.code).toBe("group.max");
    expect(issue?.message).toContain("Wargear");
    expect(issue?.entryId).toBe("e.captain");
    expect(issue?.selectionId).toBe("cap");
  });

  it("choose-min violated (0 selected, min 1) → group.min error", () => {
    const r = evaluate(roster([]), cat("min", 1));
    expect(r.issues.find((i) => i.constraintId === "g.wargear.limit")?.code).toBe("group.min");
  });

  it("choose-min satisfied (1 selected, min 1) → valid", () => {
    const r = evaluate(roster(["e.sword"]), cat("min", 1));
    expect(r.valid).toBe(true);
  });

  it("a matching override dismisses a group violation", () => {
    const r = evaluate(
      roster(["e.sword", "e.axe"], [{ constraintId: "g.wargear.limit", selectionId: "cap", source: "user" }]),
      cat("max", 1),
    );
    expect(r.valid).toBe(true);
    expect(r.dismissed.some((i) => i.constraintId === "g.wargear.limit")).toBe(true);
  });
});
```

- [ ] **Шаг 2: Прогнать тест — убедиться, что падает**

Запуск: `pnpm --filter @muster/engine-eval exec vitest run test/groups.test.ts --coverage=false`
Ожидается: FAIL (движок ещё не проверяет группы; нарушения не появляются).

- [ ] **Шаг 3: Реализация — `src/groups.ts`**

```ts
import type { IrGroup, IrGroupConstraint, Issue } from "@muster/domain";
import type { EvalNode } from "./state";

// A group choose-N aggregates the owner's direct member children (members are
// flattened as direct children of the owning entry). Counts selections only.
export function checkGroupConstraint(
  gc: IrGroupConstraint,
  node: EvalNode,
  group: IrGroup,
): Issue | null {
  const actual = node.children.reduce(
    (sum, c) => (group.memberEntryIds.includes(c.entry.id) ? sum + c.effectiveCount : sum),
    0,
  );
  const violated = gc.type === "max" ? actual > gc.value : actual < gc.value;
  if (!violated) return null;

  const message =
    gc.type === "max"
      ? `Too many in "${group.name}": ${actual} exceeds max ${gc.value}`
      : `Not enough in "${group.name}": ${actual} below min ${gc.value}`;

  return {
    severity: "error",
    code: gc.type === "max" ? "group.max" : "group.min",
    message,
    selectionId: node.selectionId,
    entryId: node.entry.id,
    constraintId: gc.id,
  };
}
```

- [ ] **Шаг 4: Подключить в `evaluate()`**

В `packages/engine-eval/src/evaluate.ts` добавить импорт:

```ts
import { checkGroupConstraint } from "./groups";
```

В существующем цикле `for (const node of state.all) { for (const constraint of node.entry.constraints) { ... } }` добавить второй внутренний цикл — сразу после цикла по `node.entry.constraints`, внутри того же `for (const node ...)`:

```ts
    for (const group of node.entry.groups ?? []) {
      for (const gc of group.constraints) {
        const issue = checkGroupConstraint(gc, node, group);
        if (issue) raw.push(issue);
      }
    }
```

`?? []` обязателен: каталоги в существующих тестах — ручные литералы без
`groups` (поле опционально, Задача 1), поэтому в рантайме `node.entry.groups`
там `undefined`. Обе ветки `?? []` покрываются: `undefined` — существующими
тестами, присутствующее значение — `groups.test.ts` и контракт-тестом.

- [ ] **Шаг 5: Прогнать тест — убедиться, что проходит**

Запуск: `pnpm --filter @muster/engine-eval exec vitest run test/groups.test.ts --coverage=false`
Ожидается: PASS (все 5 сценариев).

- [ ] **Шаг 6: Коммит**

```bash
git add packages/engine-eval/src/groups.ts packages/engine-eval/src/evaluate.ts packages/engine-eval/test/groups.test.ts
git commit -m "feat(engine-eval): enforce group choose-N (group.min/group.max)"
```

---

## Задача 4: engine-eval — кросс-языковой контракт

**Файлы:**
- Изменить (синхронно с Задачей 2): `packages/engine-eval/test/fixtures/parser-golden.ir.json`
- Изменить: `packages/engine-eval/test/parser-contract.test.ts`

**Интерфейсы:**
- Потребляет: обновлённый golden парсера из Задачи 2.
- Производит: контракт-тест, доказывающий, что распарсенная группа реально ловится движком (`group.max`).

- [ ] **Шаг 1: Синхронизировать копию golden**

Скопировать байт-в-байт обновлённый golden парсера в копию движка:

```bash
cp packages/engine-parser/tests/fixtures/golden/mini40k.ir.json packages/engine-eval/test/fixtures/parser-golden.ir.json
```

- [ ] **Шаг 2: Написать падающий контракт-тест**

В `packages/engine-eval/test/parser-contract.test.ts` добавить внутрь `describe("parser IR contract", ...)` новый тест:

```ts
  it("engine-eval enforces a parsed group choose-N limit", () => {
    const cat = IrCatalogue.parse(golden);
    // Captain takes BOTH wargear options → violates g.wargear.max (max 1).
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [{
        id: "cap", entryId: "e.captain", count: 1,
        selections: [
          { id: "w1", entryId: "e.captain.sword", count: 1, selections: [] },
          { id: "w2", entryId: "e.captain.axe", count: 1, selections: [] },
        ],
      }],
    };
    const result = evaluate(roster, cat);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "g.wargear.max");
    expect(issue?.code).toBe("group.max");
  });
```

- [ ] **Шаг 3: Прогнать контракт-тест**

Запуск: `pnpm --filter @muster/engine-eval exec vitest run test/parser-contract.test.ts --coverage=false`
Ожидается: PASS (golden валидируется в Zod, распарсенная группа ловится как `group.max`).

- [ ] **Шаг 4: Полный прогон с покрытием + typecheck**

Запуск: `pnpm test && pnpm typecheck`
Ожидается: все TS-тесты зелёные, покрытие 100% на обоих пакетах, typecheck чисто.

- [ ] **Шаг 5: Коммит**

```bash
git add packages/engine-eval/test/fixtures/parser-golden.ir.json packages/engine-eval/test/parser-contract.test.ts
git commit -m "test(contract): parsed group choose-N is enforced end-to-end"
```

---

## Финальная проверка (после всех задач)

- [ ] `pnpm typecheck` — чисто
- [ ] `pnpm test` — оба TS-пакета зелёные, покрытие 100%
- [ ] `cd packages/engine-parser && cargo test` — зелёные
- [ ] `cargo deny check` и `cargo audit` — ok
- [ ] Golden парсера и копия в engine-eval байт-в-байт идентичны:
      `diff packages/engine-parser/tests/fixtures/golden/mini40k.ir.json packages/engine-eval/test/fixtures/parser-golden.ir.json`
