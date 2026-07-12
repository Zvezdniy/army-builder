# Дизайн: constraint context-scopes

**Дата:** 2026-07-12
**Статус:** утверждён к реализации
**Связано:** [[engine-parser-status]], `2026-07-11-context-aware-visibility-design.md` (C-a), `2026-07-12-entry-type-and-type-scopes-design.md`

## Проблема

`map_constraint` (парсер) дропает любой constraint-scope кроме self/parent/force/roster (`constraint.scope_unmapped`), и domain-энам `IrConstraint.scope` ограничен теми же четырьмя. При этом `engine-eval` (`AggregateSpec.scope` + `scopeNodes`) **уже** резолвит `root-entry`/`ancestor`/`unit`/`upgrade`/`model`/`model-or-unit` (добавлено в срезах C-a и type-scopes). На реальном SM недостаёт ровно **`unit`**: 4 исходных лимита `scope="unit"` (3 max + 1 min, `field=selections`, `includeChildSelections=true`) → **90** enforced-инстансов после инлайнинга. Это «лимиты на юнит» (напр. «не больше 1 реликвии на юнит»).

## Ключевое отличие от условий

Constraints **энфорсят**: нарушение → `error` → ростер `invalid`. Поэтому нельзя допускать **ложных** нарушений. Опасен только `min`: type-scope без якоря (нет предка нужного типа) даёт пустой набор → `aggregate=0`; для `min` это `0 < limit` → ложное «Not enough». `max` при пустом наборе (`0 > limit` = false) безопасен сам по себе.

## Скоуп (утв. пользователем: полный набор, симметрично условиям)

Constraints принимают тот же набор scopes, что и conditions: `unit`/`upgrade`/`model`/`model-or-unit`/`root-entry`/`ancestor` (+ `primary-catalogue`→`roster`). Сегодня в данных срабатывает только `unit`; остальные — future-proof (не дропать молча).

## Слои

### 1. domain (`packages/domain/src/ir.ts`)
`IrConstraint.scope` энам расширить до 10 значений — идентично `IrCondition.scope`: `["self","parent","force","roster","root-entry","ancestor","unit","upgrade","model","model-or-unit"]`.

### 2. parser (`packages/engine-parser/src/ir/map.rs`)
`map_constraint` scope-match (строки ~261-270) расширить: `self|parent|force|roster|root-entry|ancestor|unit|upgrade|model|model-or-unit` → как есть; `primary-catalogue` → `roster`; иначе `constraint.scope_unmapped` + drop. (Симметрично `map_condition_scope`, но со своим диаг-кодом.) Golden mini40k — байт-идентичен (в фикстуре нет таких scopes).

### 3. engine-eval — never-over-enforce гард (`packages/engine-eval/src`)
`scopeNodes`/`aggregate` уже резолвят все scopes — не трогаем. Добавляем гард против ложных нарушений:
- `scopes.ts`: экспортировать `scopeUnanchored(node, spec, state): boolean` — `true` **только** когда scope ∈ {unit,upgrade,model,model-or-unit} И `scopeNodes(...)` пуст (нет якоря). Для self/parent/force/roster/root-entry/ancestor всегда `false` (их пустота легитимна — напр. «≥1 HQ» на пустом ростере должен по-прежнему ошибаться).
- `constraints.ts` `checkConstraint`: в начале `if (scopeUnanchored(node, constraint, state)) return null;` — type-scope constraint без якоря **не применяется** здесь (ни min, ни max). Пустой набор при type-scope ⟺ нет якоря; при найденном якоре поддерево ≥1 узла, и 0 совпадений = легитимное нарушение (не подавляется).

### 4. cross-language contract
Тест e2e: `unit`-scope `max` лимит на предмете внутри юнита энфорсится (превышение → error); он же без юнита-якоря (аномальное размещение) → пропущен, не ложная ошибка. Golden + Zod-контракт зелёные.

## Инвариант «никогда не мискомпилировать / не over-enforce»
- Новое enforcement только для якорируемых scopes; `max` безопасен структурно; `min` защищён гардом на type-scopes.
- Существующее поведение self/parent/force/roster/root-entry/ancestor не меняется (гард их не трогает).
- Все реальные unit-constraints `includeChildSelections=true` → полный подсчёт поддерева; **не** задевают отложенный `includeChildSelections=false` container-scope долг (отдельная фон-задача).

## Тесты
**domain (`test/ir.test.ts`):** `IrConstraint` парсит новые scopes (напр. `unit`, `root-entry`).
**parser (`tests/map.rs`):** constraint scope=`unit` маппится (нет `constraint.scope_unmapped`); `primary-catalogue`→`roster`; неизвестный scope по-прежнему дропается.
**engine-eval (`test/constraints.test.ts`):**
- `unit`-scope max: предмет ×2 в юните при `max 1 unit` → `constraint.max` error; ×1 → ok.
- `unit`-scope min: юнит с 0 требуемых при `min 1 unit` (якорь есть, 0 совпадений) → error (легитимно).
- type-scope без якоря (узел без предка нужного типа) → `checkConstraint` возвращает null (гард); force min на пустом ростере (scope=roster) → **по-прежнему** error (гард не трогает).
**cross-language:** unit-scope лимит из распарсенного IR энфорсится в evaluate().
**Golden:** байт-идентичен.

## Осязаемо
Реальный SM: `constraint.scope_unmapped` **90→0**; лимиты «на юнит» энфорсятся в билдере.

## Явно НЕ делаем
- `includeChildSelections=false` семантика container-scopes (отдельная фон-задача).
- GUID-scope constraints (если появятся — отдельный механизм, как у условий).
