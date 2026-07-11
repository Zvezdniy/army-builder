# Дизайн: context-aware видимость (срез C-a) — scopes parent/root-entry/ancestor/primary-catalogue

**Дата:** 2026-07-11
**Статус:** утверждён к реализации
**Связано:** [[engine-parser-status]], `2026-07-11-conditional-visibility-design.md` (срез A+B)

## Проблема

Срез A+B закрыл видимость для scopes self/force/roster, но **отложил контекст-зависимые scopes**: на реальном SM **24 749** hidden-модификаторов дропнуты (`modifier.hidden_condition_unmapped`), т.к. их условия используют `parent`/`root-entry`/`ancestor`/`primary-catalogue` (и почти-нулевые `unit`/`upgrade`). Среди них доминирует `parent`. Эти гейты — скрытие опций **внутри юнита** по контексту (родитель/корень/предки), которое A+B не мог вычислить на бесродительском синтетическом узле (из-за чего был CRITICAL с parent).

## Идея

Для опций **конфига** владелец известен (`optionsFor(selectionId)` вызывается для конкретного выбранного юнита). Если синтетический узел опции **прикрепить к узлу-владельцу**, то `parent`/`root-entry`/`ancestor` разрешаются по **реальной цепочке предков** — корректно и без пере-скрытия. `primary-catalogue` в одно-каталожной модели ≡ `roster` (context-free алиас).

## Скоуп (C-a)

**Делаем:** scopes `parent`, `root-entry`, `ancestor`, `primary-catalogue`(→roster) для **условий видимости** (и попутно cost-модификаторов), с owner-контекстом для опций конфига.

**НЕ делаем (отдельные срезы):**
- `unit`/`upgrade` scopes — нужен `IrEntry.type` (плумбинг parser→IR→domain), ценность ~нулевая (1+1). Отложено.
- Расширение scopes для **constraints** — `map_constraint` остаётся на self/parent/force/roster (609 `constraint.scope_unmapped` root-entry не трогаем; это отдельный лимит-срез, чтобы не менять внезапно enforcement).
- entryLink-hosted hidden — как и в A+B, отдельный срез (raw+resolve).
- hidden уже выбранных узлов — отложено.

## Инвариант «никогда не пере-скрывать» (перенос гарантии)

A+B держал гарантию в парсере (отвергал parent). Теперь parent/root-entry/ancestor **маппятся**, а гарантия переезжает в engine-eval:
- Видимость опции вычисляется на синтетическом узле, **привязанном к владельцу**. С реальной цепочкой предков parent/root-entry/ancestor разрешаются достоверно.
- В контексте **без владельца** (пикер топ-юнитов, `owner=null`) модификатор, чей гейт использует context-scope (`parent`/`root-entry`/`ancestor`), **пропускается целиком → сущность видима**. Никогда не схлопываем context-scope в self на бесродительском узле.
- Парсерное отвержение parent (`map_hidden_condition`) из A+B **удаляется** — единственный потребитель видимости (`hiddenEntryIds`) теперь несёт гарантию через owner-контекст + skip-правило.

## Слои

### 1. Domain
- `IrCondition.scope` enum += `"root-entry"`, `"ancestor"` (было self/parent/force/roster). `IrConstraint.scope` НЕ трогаем.
- engine-eval `AggregateSpec.scope` тип += те же (супермножество; IrConstraint с 4 scopes остаётся подмножеством).

### 2. Parser (`ir/map.rs`)
- Новый `map_condition_scope(scope, …)`: self|parent|force|roster→как есть; `root-entry`→`root-entry`; `ancestor`→`ancestor`; `primary-catalogue`→`roster`; иначе диагностика + None. `map_condition` использует его вместо общего `map_scope`.
- `map_constraint` продолжает использовать существующий (ограниченный) `map_scope` — constraints без изменений.
- Удалить `map_hidden_condition` (parent-rejection A+B); strict-путь видимости снова использует `map_condition` напрямую (parent/root-entry/ancestor теперь валидны).
- Golden mini40k — байт-идентичен (нет таких scopes в фикстуре).

### 3. engine-eval
- `scopes.ts` `scopeNodes` += ветки:
  - `root-entry`: подняться по `parent` до корня, вернуть `subtree(top, includeChildSelections)`.
  - `ancestor`: вернуть цепочку узлов-предков `[node.parent, …]` (без самого узла).
  `AggregateSpec.scope` тип расширить.
- `visibility.ts` `hiddenEntryIds(roster, catalogue, ownerSelectionId?)`:
  - `owner` = узел `state.all` с этим `selectionId` (или null).
  - синтетический узел: `parent: owner`.
  - для каждого visibility-модификатора: если `owner===null` И гейт использует context-scope (`usesContextScope`) → **пропустить** (видимо); иначе `passesGate(...)` → `isHidden = m.set`.
  - `usesContextScope(m)` — рекурсивный обход conditions/conditionGroups на scope ∈ {parent, root-entry, ancestor}.

### 4. web
- `App`: набор для пикера — `hiddenEntryIds(roster, catalogue)` (без владельца) → `AddUnitPicker`.
- `UnitConfig`: вычисляет **свой** owner-scoped набор `useMemo(() => hiddenEntryIds(roster, catalogue, selection.id), [roster, catalogue, selection.id])` и фильтрует `options`/членов групп (сохраняя правило «уже выбранный член остаётся видимым»). Проброс `hiddenIds` через `SelectionNode`/`UnitDetail` убрать — `UnitConfig` считает сам (у него есть roster+catalogue+selection).

## Тесты

**Domain:** IrCondition round-trip со scope `root-entry`/`ancestor`.

**Parser (`tests/map.rs`):**
1. hidden-модификатор с `instanceOf` scope=`parent` → эмитится (scope `parent`), НЕ дропается.
2. scope `root-entry`/`ancestor`/`primary-catalogue` → маппятся (`primary-catalogue`→`roster`).
3. cost-модификатор с condition scope=`root-entry` → condition сохраняется (не `condition.scope_unmapped`).
4. constraint scope=`root-entry` → по-прежнему `constraint.scope_unmapped` (constraints не расширяли).

**engine-eval (`test/scopes.test.ts`, `test/visibility.test.ts`):**
5. `aggregate` scope `root-entry`: цель в корне юнита, узел глубоко → считается; `ancestor`: предок совпадает → считается.
6. `hiddenEntryIds` с owner: опция с гейтом `notInstanceOf parent <cat>` → при владельце без cat скрыта/показана корректно; без owner (тот же гейт) → **не** скрыта (skip).
7. `hiddenEntryIds` без owner: гейт с `root-entry`/`ancestor` → сущность видима (skip); гейт только с roster → вычисляется как раньше.

**web:** `UnitConfig` прячет опцию, скрытую в owner-контексте.

**Golden:** без изменений.

**Осязаемо:** реальный SM → `modifier.hidden_condition_unmapped` резко падает (parent/root-entry/ancestor/primary-catalogue больше не дропаются); в билдере опции внутри юнита скрываются/показываются по контексту владельца.

## Риски
- **Пере-скрытие в no-owner** — исключено skip-правилом (context-scope без владельца → видимо).
- **Перф** — `UnitConfig` строит symbol-table+state на свой owner-набор (useMemo по owner). Для типовых ростеров дёшево; при больших — отдельная оптимизация (единый visibility-контекст) позже.
- **Расширение condition-scope задевает cost-модификаторы** — их condition scope root-entry/ancestor теперь вычисляется движком корректно на реальных узлах; аддитивно, не мискомпиляция.
