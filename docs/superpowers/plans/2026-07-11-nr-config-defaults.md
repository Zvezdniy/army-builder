# Заход 2 — defaults (преднаполнение юнита) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Юнит появляется в ростере с базовым лоадаутом (как в New Recruit): парсер читает `defaultSelectionEntryId`, а `@muster/roster` при добавлении юнита авто-выбирает дефолты групп и заполняет обязательные (min≥1) опции.

**Architecture:** Rust-парсер эмитит новое опциональное поле `IrGroup.defaultMemberEntryId`; домен-схема его принимает; `@muster/roster.addUnit` строит начальное поддерево выбора из дефолтов и min-ограничений. Веб не меняет логику — юнит просто приходит преднаполненным.

**Tech Stack:** Rust (quick-xml, serde), TypeScript (Zod, Vitest), React.

## Global Constraints

- Rust: `#![forbid(unsafe_code)]`; новое поле **опционально** и не ломает существующий вывод; **golden `mini40k.ir.json` остаётся байт-идентичным** (поле `skip_serializing_if = Option::is_none`, а входной golden `.cat` его не содержит).
- Никогда-не-мискомпилировать: пустой/отсутствующий `defaultSelectionEntryId` → `None`, не угадывать.
- Домен + engine-eval публичный контракт: `IrGroup` получает **опциональное** поле — существующий golden IR остаётся валидным; кросс-язык контракт держится.
- `@muster/roster` — чистый, иммутабельный, **100%** покрытие (общий `vitest.shared.ts`, логика в `builder.ts`).
- `apps/web` — не под порогом покрытия.
- Код/идентификаторы/коммиты на английском. Реальные GW-данные в git не идут.

## Типы (справка)

- Rust `RawGroup` (`raw/model.rs`): `id,name,entries,groups,entry_links,constraints,modifiers` — добавить `default_selection_entry_id: String`.
- Rust `IrGroup` (`ir/model.rs`): `id,name,member_entry_ids,constraints` — добавить `default_member_entry_id: Option<String>`.
- TS `IrGroup` (`domain/src/ir.ts`): `{ id,name,memberEntryIds,constraints }` — добавить `defaultMemberEntryId?: string`.
- `resolve_group` (`resolve/links.rs`) уже делает `group.clone()` → новое raw-поле переносится через резолв без правок.

---

## Task 1: парсер читает `defaultSelectionEntryId` → `IrGroup.defaultMemberEntryId`

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs` (RawGroup)
- Modify: `packages/engine-parser/src/raw/parse.rs` (read_group + Empty-случай)
- Modify: `packages/engine-parser/src/ir/model.rs` (IrGroup)
- Modify: `packages/engine-parser/src/ir/map.rs` (map_group)
- Test: `packages/engine-parser/tests/raw_parse.rs`, `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Produces: IR-группы несут `"defaultMemberEntryId": "<id>"` когда в `.cat` у `<selectionEntryGroup>` есть `defaultSelectionEntryId`; иначе поле отсутствует.

- [ ] **Step 1: RawGroup получает поле**

В `raw/model.rs`, в `struct RawGroup { ... }` добавить поле (после `name`):
```rust
    pub default_selection_entry_id: String,
```
(Struct — `#[derive(Debug, Default, Clone)]`, поэтому `Default` покрывает новое поле.)

- [ ] **Step 2: parse.rs читает атрибут в обоих местах**

В `read_group` (конструкция `let mut group = RawGroup { ... }`) добавить строку рядом с `name`:
```rust
        default_selection_entry_id: attr(start, b"defaultSelectionEntryId").unwrap_or_default(),
```
И в `read_groups_into`, в ветке `Event::Empty(e) ... => { dst.push(RawGroup { ... }) }` добавить:
```rust
                        default_selection_entry_id: attr(&e, b"defaultSelectionEntryId").unwrap_or_default(),
```

- [ ] **Step 3: raw_parse тест (падает — поле ещё не читается? нет, читается после Step 2 — пишем тест ПЕРЕД Step 2 в реальном порядке)**

Порядок TDD: сначала тест, потом Step 2. Добавить в `tests/raw_parse.rs` тест, парсящий каталог с группой, у которой есть `defaultSelectionEntryId`, и проверяющий, что распарсенная `RawGroup.default_selection_entry_id == "e.def"`. Использовать существующий в файле способ парсинга (см. соседние тесты — они зовут внутренний parse и смотрят raw-модель; если raw-модель не публична для интеграционных тестов, тест писать в `#[cfg(test)] mod tests` внутри `raw/parse.rs`). Минимальный XML:
```xml
<catalogue id="c" name="C" gameSystemId="g" revision="1">
 <sharedSelectionEntries>
  <selectionEntry id="u" name="U" type="unit">
   <selectionEntryGroups>
    <selectionEntryGroup id="g" name="G" defaultSelectionEntryId="e.def">
     <selectionEntries>
      <selectionEntry id="e.def" name="Def" type="upgrade"/>
     </selectionEntries>
     <constraints>
      <constraint type="max" value="1" field="selections" scope="parent" id="c1"/>
     </constraints>
    </selectionEntryGroup>
   </selectionEntryGroups>
  </selectionEntry>
 </sharedSelectionEntries>
</catalogue>
```
Ассерт: у распарсенной группы `default_selection_entry_id == "e.def"`.
Run: `cargo test -p muster-engine-parser default_selection` → сперва FAIL (поле не читается), после Step 2 PASS.

- [ ] **Step 4: IrGroup получает опциональное поле**

В `ir/model.rs`, в `pub struct IrGroup { ... }` добавить (после `name`, перед `member_entry_ids`):
```rust
    #[serde(rename = "defaultMemberEntryId", skip_serializing_if = "Option::is_none")]
    pub default_member_entry_id: Option<String>,
```

- [ ] **Step 5: map_group заполняет поле**

В `ir/map.rs`, в `map_group`, заменить конструкцию возврата:
```rust
    Some(IrGroup { id: g.id.clone(), name: g.name.clone(), member_entry_ids, constraints })
```
на:
```rust
    let default_member_entry_id = (!g.default_selection_entry_id.is_empty())
        .then(|| g.default_selection_entry_id.clone());
    Some(IrGroup {
        id: g.id.clone(),
        name: g.name.clone(),
        default_member_entry_id,
        member_entry_ids,
        constraints,
    })
```

- [ ] **Step 6: map тест (эмиссия поля)**

В `tests/map.rs` добавить тест: собрать `RawCatalogue` с юнитом, где группа имеет `default_selection_entry_id = "e.def"` и `max=1` constraint (иначе map_group вернёт None), прогнать `to_ir`, найти группу в IR и проверить `defaultMemberEntryId == "e.def"`. Второй кейс: пустой `default_selection_entry_id` → поле отсутствует (serialize в JSON не содержит ключа). Использовать паттерн существующих тестов в `map.rs`.
Run: `cargo test -p muster-engine-parser` → все зелёные.

- [ ] **Step 7: golden не дрейфует**

Run: `cargo test -p muster-engine-parser parser_output_matches_golden`
Expected: PASS (golden `.cat` не содержит defaults → IR байт-идентичен).

- [ ] **Step 8: clippy + commit**

Run: `cargo clippy -p muster-engine-parser --all-targets -- -D warnings` (чисто на изменённых файлах).
```bash
git add packages/engine-parser
git commit -m "feat(parser): emit IrGroup.defaultMemberEntryId from defaultSelectionEntryId"
```

---

## Task 2: домен-схема `IrGroup.defaultMemberEntryId`

**Files:**
- Modify: `packages/domain/src/ir.ts`
- Test: `packages/domain/src/ir.test.ts` (или существующий тест-файл IR — использовать тот же, где тестируется IrGroup)

**Interfaces:**
- Consumes: IR JSON из парсера (Task 1).
- Produces: `IrGroup` тип с `defaultMemberEntryId?: string` — потребляется `@muster/roster` (Task 3).

- [ ] **Step 1: тест (падает)**

Найти тест-файл, где валидируется `IrGroup` (искать `IrGroup` в `packages/domain/src/*.test.ts`). Добавить кейс:
```ts
it("IrGroup accepts an optional defaultMemberEntryId", () => {
  const g = IrGroup.parse({ id: "g", name: "G", memberEntryIds: ["a"], constraints: [], defaultMemberEntryId: "a" });
  expect(g.defaultMemberEntryId).toBe("a");
});
it("IrGroup defaultMemberEntryId is optional", () => {
  const g = IrGroup.parse({ id: "g", name: "G", memberEntryIds: [], constraints: [] });
  expect(g.defaultMemberEntryId).toBeUndefined();
});
```
Run: `pnpm --filter @muster/domain test` → FAIL (unknown key stripped / поле не в типе).

- [ ] **Step 2: добавить поле в схему**

В `packages/domain/src/ir.ts`, в `export const IrGroup = z.object({ ... })` добавить (после `name`):
```ts
  defaultMemberEntryId: z.string().optional(),
```

- [ ] **Step 3: тесты + 100% покрытие**

Run: `pnpm --filter @muster/domain test`
Expected: PASS, покрытие 100% (домен под общим порогом).

- [ ] **Step 4: commit**

```bash
git add packages/domain
git commit -m "feat(domain): IrGroup.defaultMemberEntryId (optional)"
```

---

## Task 3: `@muster/roster` преднаполняет юнит + веб-демо

**Files:**
- Modify: `packages/roster/src/builder.ts` (`addUnit` + новый хелпер `initialSubtree`)
- Test: `packages/roster/src/builder.test.ts`
- Modify: `apps/web/src/mini40k.ir.json` (добавить `defaultMemberEntryId` в Special Weapon; Marine min≥1 уже есть)
- Modify: `apps/web/src/builder.test.tsx` (юнит приходит преднаполненным)

**Interfaces:**
- Consumes: `IrGroup.defaultMemberEntryId` (Task 2), существующие `catalogueEntry`, констрейнты.
- Produces: `addUnit` возвращает юнит с преднаполненным поддеревом.

- [ ] **Step 1: тесты (падают)**

В `packages/roster/src/builder.test.ts` добавить блок. Использовать каталог с дефолтом и min:
```ts
const defCat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "g", revision: 1, forceConstraints: [],
  entries: [{
    id: "u", name: "U", costs: [], categories: [], constraints: [],
    children: [
      { id: "w.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [] },
      { id: "w.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [] },
      { id: "m", name: "Model", costs: [], categories: [],
        constraints: [{ id: "m.min", type: "min", value: 3, field: "selections", scope: "self", targetType: "entry", targetId: "m", includeChildSelections: false }],
        children: [] },
    ],
    groups: [
      { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"], defaultMemberEntryId: "w.sword",
        constraints: [{ id: "gw.min", type: "min", value: 1 }, { id: "gw.max", type: "max", value: 1 }] },
    ],
  }],
};

describe("addUnit prepopulates from defaults and mins", () => {
  it("selects a group's default member on add", () => {
    const r = addUnit(createRoster(defCat, 2000), "u");
    const kids = r.selections[0]!.selections.map((s) => s.entryId);
    expect(kids).toContain("w.sword");
    expect(kids).not.toContain("w.axe");
  });

  it("fills a min>=1 option to its minimum count", () => {
    const r = addUnit(createRoster(defCat, 2000), "u");
    const model = r.selections[0]!.selections.find((s) => s.entryId === "m");
    expect(model?.count).toBe(3);
  });

  it("adds nothing for optional groups without a default", () => {
    const optCat: IrCatalogue = {
      ...defCat,
      entries: [{ ...defCat.entries[0]!, groups: [
        { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"],
          constraints: [{ id: "gw.max", type: "max", value: 1 }] },
      ], children: [defCat.entries[0]!.children[0]!, defCat.entries[0]!.children[1]!] }],
    };
    const r = addUnit(createRoster(optCat, 2000), "u");
    expect(r.selections[0]!.selections).toEqual([]);
  });
});
```
Run: `pnpm --filter @muster/roster test` → FAIL (addUnit не наполняет).

- [ ] **Step 2: реализовать преднаполнение**

В `packages/roster/src/builder.ts` заменить `addUnit`:
```ts
/** Append a root unit selection, prepopulated with its default/required loadout. */
export function addUnit(roster: Roster, entryId: string, catalogue?: IrCatalogue): Roster {
  const seed = freshSelection(entryId);
  const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
  const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
  return { ...roster, selections: [...roster.selections, selection] };
}
```
и добавить чистый хелпер (после `freshSelection`):
```ts
/** Build the initial child selections for an entry: group defaults + min-required options. */
function initialChildren(entry: IrEntry): RosterSelection[] {
  const kids: RosterSelection[] = [];
  const grouped = new Set((entry.groups ?? []).flatMap((g) => g.memberEntryIds));

  for (const g of entry.groups ?? []) {
    const min = g.constraints.find((c) => c.type === "min")?.value ?? 0;
    const pick = g.defaultMemberEntryId ?? (min >= 1 ? g.memberEntryIds[0] : undefined);
    if (pick !== undefined) kids.push(seedChild(entry, pick));
  }
  for (const child of entry.children) {
    if (grouped.has(child.id)) continue; // group members handled above
    const min = ownMin(child);
    if (min >= 1) kids.push(seedChild(entry, child.id));
  }
  return kids;
}

/** A fresh child selection for `entryId`, counted to that option's own min (>=1). */
function seedChild(parent: IrEntry, entryId: string): RosterSelection {
  const child = parent.children.find((c) => c.id === entryId);
  const count = child ? Math.max(1, ownMin(child)) : 1;
  const grandkids = child ? initialChildren(child) : [];
  return { id: crypto.randomUUID(), entryId, count, selections: grandkids };
}

/** An entry's own min selections-count bound (scope self/parent), else 0. */
function ownMin(entry: IrEntry): number {
  return entry.constraints.find(
    (c) => c.field === "selections" && (c.scope === "self" || c.scope === "parent") && c.type === "min",
  )?.value ?? 0;
}
```
Примечание: `addUnit` получает необязательный `catalogue` — если не передан, ведёт себя как раньше (без наполнения), сохраняя существующие тесты, которые зовут `addUnit(r, id)` без каталога. Вызовы в UI передают каталог.

- [ ] **Step 3: тесты + 100%**

Run: `pnpm --filter @muster/roster test`
Expected: PASS; покрытие 100% (все ветки `initialChildren`/`seedChild`/`ownMin` покрыты — включая default, min-fallback, optional-none, вложенное поддерево, и ветку `child undefined` в seedChild — добавить кейс с `defaultMemberEntryId`, указывающим на id, которого нет в `children`, → `count=1`, `grandkids=[]`).

Добавить недостающие покрывающие кейсы если coverage < 100% (например default на несуществующий id).

- [ ] **Step 4: веб зовёт addUnit с каталогом + дефолт в фикстуре**

В `apps/web/src/App.tsx`, в обработчике палитры заменить:
```tsx
onAdd={(id) => setRoster((r) => addUnit(r, id))}
```
на:
```tsx
onAdd={(id) => setRoster((r) => addUnit(r, id, catalogue))}
```
В `apps/web/src/mini40k.ir.json`, у группы `g.assault.weapon` добавить поле рядом с `name`:
```json
      "defaultMemberEntryId": "e.assault.chainsword",
```

- [ ] **Step 5: обновить веб-тест взаимодействия под преднаполнение**

В `apps/web/src/builder.test.tsx`, в тесте «derives controls...», добавление Assault Squad теперь приходит с Chainsword (default) + Marine (min 1). Обновить ожидания: после `add Assault Squad` очки = 80 + 5 (Chainsword) + 18 (Marine) = **103**; Special Weapon уже имеет выбранный Chainsword (кнопка `deselect Chainsword` присутствует); свап на Plasma → 80 + 15 + 18 = **113**. Переписать ассерты этого теста согласно новым числам; тест на required-no-empty остаётся валиден (Chainsword уже выбран по умолчанию). `App.test.tsx` (0/2000, пустой ростер) не трогается.
Run: `pnpm --filter @muster/web test` → PASS.

- [ ] **Step 6: весь монорепо + сборка**

Run: `pnpm test && pnpm --filter @muster/web build`
Expected: turbo 4/4 зелёный; сборка ок.

- [ ] **Step 7: commit**

```bash
git add packages/roster apps/web
git commit -m "feat(roster): prepopulate unit loadout from group defaults and option mins"
```

---

## Self-Review

**Покрытие спеки (дизайн 2026-07-11-nr-config-mechanics, Заход 2):**
- Парсер читает `defaultSelectionEntryId` → `IrGroup.defaultMemberEntryId` — Task 1.
- Домен-схема поля — Task 2.
- `addUnit` авто-выбирает дефолты групп + заполняет min-опции, рекурсивно — Task 3.
- Юнит приходит с базовым лоадаутом в вебе — Task 3 (Step 4-5), точка «пощупать».
- Golden байт-идентичен; кросс-язык контракт держится — Task 1 (Step 7) + опциональность поля.

**Плейсхолдеры:** нет — код каждого шага приведён; точечные тесты используют существующие паттерны файлов (реализатор смотрит соседние тесты для точной формы вызова parse/to_ir).

**Согласованность типов:** `default_selection_entry_id: String` (raw) → `default_member_entry_id: Option<String>` (Rust IR, rename `defaultMemberEntryId`) → `defaultMemberEntryId?: string` (TS) → читается в `initialChildren`. `addUnit(roster, entryId, catalogue?)` — новый необязательный параметр не ломает существующие вызовы без каталога.
