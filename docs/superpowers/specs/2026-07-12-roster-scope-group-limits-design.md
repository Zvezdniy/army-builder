# Дизайн: roster-scope групповые лимиты

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[engine-parser-status]], `2026-07-11-group-choose-n.md`, `2026-07-11-nested-group-choose-n.md`, `2026-07-12-constraint-context-scopes-design.md`

## Проблема

`selectionEntryGroup` может нести constraint со `scope="roster"` — «на всю армию» лимит (напр. «0-1 варлорд-трейта на армию», «0-1 реликвии на армию»). Сейчас `map_group_constraint` дропает всё кроме group-local (self/parent/own-id) → **949** `group.constraint_dropped` с «non-group-local scope roster». Это крупнейший когерентный enforcement-пробел.

## Механика и ключевая тонкость

- `IrGroupConstraint = {id, type, value}` (без scope); `checkGroupConstraint(gc, node, group)` считает **прямых членов владельца** (`node.children` ∈ `memberEntryIds`) — per-owner локально.
- **Тонкость инлайнинга:** shared-группа (общая оружейка/реликвии) инлайнится в N мест — N копий `IrGroup` с ОДИНАКОВЫМИ `id` и `memberEntryIds`. roster-scope лимит — это ОДНО армейское правило; наивная проверка на каждой копии дала бы N дубликатов ошибки. Нужен dedup + army-level issue (без привязки к одному узлу).

## Скоуп

**Делаем:** `scope="roster"` для групповых лимитов (min/max, field=selections). self/parent/own-id → как сейчас (локально). Прочее (modifier-on-limit 283, non-selections) — по-прежнему громкий дроп.

**НЕ делаем:** modifier-on-limit групповые лимиты (отдельный conditional-срез); force-scope групповые (в данных отсутствуют — 0).

## Слои

### 1. domain (`packages/domain/src/ir.ts`)
`IrGroupConstraint` += `scope: z.enum(["self", "roster"]).default("self")`. Дефолт `"self"` → существующий IR без поля читается как локальный (обратная совместимость).

### 2. parser (`packages/engine-parser/src`)
- `ir/model.rs`: `IrGroupConstraint` += `pub scope: String` с `#[serde(skip_serializing_if = "is_self")]` (хелпер `fn is_self(s: &str) -> bool { s == "self" }`) → эмитим scope только когда `!= "self"`, golden байт-идентичен.
- `ir/map.rs` `map_group_constraint`: заменить дроп-по-scope. `self`/`parent`/`g.id` → `scope="self"` (текущая локальная семантика сохранена). `roster` → `scope="roster"`. Иначе (другой foreign-id, force и т.п.) → прежний громкий дроп. Modifier-on-limit и non-selections дропы — без изменений.

### 3. engine-eval (`packages/engine-eval/src`)
- `groups.ts` `checkGroupConstraint(gc, node, group, state)` (+`state: EvalState`):
  - `scope === "roster"` → `actual` = сумма `effectiveCount` по `state.all`, где `n.entry.id ∈ group.memberEntryIds`. Issue **без `selectionId`/`entryId`** (армейский уровень), `constraintId = gc.id`.
  - иначе (`"self"`) → текущий подсчёт `node.children` (без изменений), issue с `selectionId`/`entryId` владельца.
  - `min` на roster: `0 < value` — легитимная ошибка (как force-min «≥1 HQ»); **гард не нужен** (roster всегда «заякорен» на весь ростер).
- `evaluate.ts`: dedup roster-scope групповых лимитов. В цикле `for group … for gc …`: если `gc.scope === "roster"`, ключ `\`${group.id}:${gc.id}\``; при повторе — `continue` (проверяем один раз, счёт всё равно roster-wide идентичен). Передать `state` в `checkGroupConstraint`.

### 4. cross-language contract
Тест e2e: roster-scope групповой max из распарсенного IR энфорсится в `evaluate()` один раз (не дублируется) при инлайнинге в несколько мест.

## Инвариант «никогда не мискомпилировать»
- Локальные (self) лимиты — семантика без изменений (golden байт-идентичен, scope skip-serialized).
- roster-scope считает реально выбранные члены по всему ростеру (state.all строится из фактических выборов) — не переучёт.
- Dedup гарантирует один issue на армейское правило, а не N.
- min на roster легитимен без гарда (весь ростер — валидная область).

## Тесты
**domain (`test/ir.test.ts`):** `IrGroupConstraint` парсит `scope:"roster"`; без scope → дефолт `"self"`.
**parser (`tests/map.rs`):** групповой constraint scope=`roster` → эмитится со `scope="roster"`, нет `group.constraint_dropped`; scope=`self`/`parent`/own-id → `scope` не сериализован (skip); чужой foreign-id → по-прежнему дроп.
**engine-eval (`test/groups.test.ts`):**
- roster-scope max: 2 члена группы по ростеру при `max 1 roster` → `group.max` error, `selectionId` undefined.
- roster-scope min: 0 членов при `min 1 roster` → `group.min` error.
- self-scope (существующее поведение) не изменилось.
**evaluate (`test/evaluate.test.ts`):** shared-группа с roster-scope max, инлайненная в 2 узла, превышение → **ровно один** `group.max` issue (dedup).
**Golden:** байт-идентичен.

## Осязаемо
Реальный SM: `group.constraint_dropped` **1232→283** (остаток = отложенный modifier-on-limit); армейские лимиты «0-1/армию» энфорсятся в билдере.
