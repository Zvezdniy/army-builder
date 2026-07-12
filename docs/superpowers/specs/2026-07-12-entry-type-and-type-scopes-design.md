# Дизайн: `IrEntry.type` + type-based condition scopes (unit/upgrade/model/model-or-unit)

**Дата:** 2026-07-12
**Статус:** утверждён к реализации
**Связано:** [[engine-parser-status]], `2026-07-11-context-aware-visibility-design.md` (срез C-a)

## Проблема

BattleScribe `selectionEntry` несёт атрибут `type` (`unit`/`upgrade`/`model`), который в raw-слое парсера уже читается (`RawEntry.entry_type`), но **теряется на границе raw→IR**: ни `IrEntry` парсера, ни domain-схема тип не несут. Из-за этого:

1. Тип недоступен продукту (web-UI не может отличить юнит от апгрейда/модели).
2. Четыре type-based condition-scope на реальном SM дропаются как `condition.scope_unmapped`, потому что их резолвинг требует типа предка:

| scope | кол-во (реальный SM) | семантика |
|---|---|---|
| `upgrade` | 79 | ближайший предок (включая self) с `type="upgrade"` |
| `model` | 129 | … `type="model"` |
| `model-or-unit` | 54 | … `type` ∈ {model, unit} |
| `unit` | 8 | … `type="unit"` |

Итого **~270** условий. Типы в реальном каталоге ровно три: `model` / `unit` / `upgrade`.

## Идея

`IrEntry.type` — фундаментальное переиспользуемое поле. Протягиваем его raw→IR→domain и выставляем наружу (доступно web-UI и движку). На его основе движок резолвит четыре type-based scope единым механизмом: подъём по цепочке предков (включая сам узел) до первого узла нужного типа, затем агрегирование по его поддереву.

## Скоуп

**Делаем:** поле `IrEntry.type` сквозь все слои + четыре type-based scope (`unit`, `upgrade`, `model`, `model-or-unit`) для **условий** (видимость + гейты cost/constraint-модификаторов) + минимальный осязаемый бейдж типа в билдере.

**НЕ делаем (отдельные срезы):**
- **GUID-scope** (`scope="<entry-id>"`, ~90 условий) — другой механизм (ближайший предок, совпадающий с конкретным entry id), не про type.
- Расширение type-scopes на **constraints** — `map_constraint` остаётся на self/parent/force/roster (как в C-a; enforcement не трогаем).

## Инвариант «никогда не мискомпилировать / не пере-скрывать»

- Если у сущности `type` отсутствует или неизвестен — поле `undefined`, сущность остаётся **валидной и видимой**. Scope с типом просто не найдёт совпадения → пустой набор → условие не выполняется в пользу показа. Никогда не роняем сущность из-за неизвестного типа.
- Type-based scopes требуют цепочку предков. В контексте **без владельца** (пикер топ-юнитов, `owner=null`) модификатор видимости с таким гейтом **пропускается целиком → сущность видима** (перенос гарантии, как у parent/root-entry/ancestor в C-a).

## Слои

### 1. Domain (`packages/domain/src`)
- `ir.ts`: `IrEntry` интерфейс += `type?: "unit" | "upgrade" | "model"`; Zod-схема += `type: z.enum(["unit","upgrade","model"]).optional()`. Опционально — отсутствие/неизвестность даёт `undefined`.
- `conditions.ts`: `IrCondition.scope` enum += `"unit"`, `"upgrade"`, `"model"`, `"model-or-unit"` (к текущим self/parent/force/roster/root-entry/ancestor).

### 2. Parser (`packages/engine-parser/src`)
- `ir/model.rs`: `IrEntry` += `pub entry_type: Option<String>` с `#[serde(rename = "type", skip_serializing_if = "Option::is_none")]`.
- `ir/map.rs`:
  - `map_entry` заполняет `entry_type` из `RawEntry.entry_type`: значение нормализуется — если ∈ {`unit`,`upgrade`,`model`} → `Some`, иначе (пусто/неизвестно) → `None` + диагностика `entry.type_unmapped` (сущность НЕ роняется). Хелпер `map_entry_type(raw: &str, entry_id, diags) -> Option<String>`.
  - `map_condition_scope` пропускает `unit`/`upgrade`/`model`/`model-or-unit` как есть (добавить в match-рукав рядом с root-entry/ancestor).
- **Golden `tests/fixtures/golden/mini40k.ir.json` регенерируется** — каждая сущность фикстуры теперь несёт `type` (ожидаемо; байт-идентичность не сохраняется). Регенерация: `cargo run --bin muster-parse tests/fixtures/mini40k.cat`.

### 3. engine-eval (`packages/engine-eval/src`)
- `scopes.ts`:
  - `AggregateSpec.scope` union += `"unit" | "upgrade" | "model" | "model-or-unit"`.
  - Хелпер `nearestByType(node, pred: (t?: string) => boolean): EvalNode | null` — идёт от `node` вверх по `parent`, **включая сам `node`**, возвращает первый с `pred(n.entry.type)===true`, иначе `null`.
  - `scopeNodes` ветки: `unit`→`nearestByType(n, t=>t==="unit")`; `upgrade`→`==="upgrade"`; `model`→`==="model"`; `model-or-unit`→`t==="model"||t==="unit"`. Если найден → `subtree(matched, includeChildSelections)`; если `null` → `[]`. Без owning node (`!node`) для этих scope → `[]` (как ветка ancestor/root-entry требует node; здесь пустой набор безопаснее исключения, т.к. type-scope может законно не иметь предка).
- `visibility.ts`: `CONTEXT_SCOPES` += `"unit"`, `"upgrade"`, `"model"`, `"model-or-unit"` — без владельца модификатор с таким гейтом пропускается (never-over-hide).

### 4. web (`apps/web/src`)
- Минимальный бейдж типа сущности (`unit`/`upgrade`/`model`) в билдере (например, в заголовке `UnitConfig` или строках опций), читая `entry.type`. Без нового состояния/логики — чисто отображение, чтобы проброс был виден end-to-end. Если `type` отсутствует — бейдж не рисуется.

## Тесты

**domain (`test/`):**
- `IrEntry` round-trip с `type` каждого из трёх значений и без него (→ undefined).
- `IrCondition` парсит четыре новых scope.

**parser (`tests/map.rs`):**
- `type` эмитится для сущностей unit/upgrade/model.
- Неизвестный/пустой `entry_type` → поле опущено в IR + диагностика `entry.type_unmapped`.
- Условие со scope `unit`/`upgrade`/`model`/`model-or-unit` маппится (нет `condition.scope_unmapped`).

**engine-eval (`test/scopes.test.ts`, `test/visibility.test.ts`):**
- `aggregate` каждого из четырёх scope: цель в поддереве найденного предка нужного типа → считается; self-match (сам узел нужного типа) → считается; `includeChildSelections` уважается; нет предка нужного типа → 0.
- `hiddenEntryIds` без owner: гейт с type-scope → сущность видима (skip); с owner → резолвится по реальной цепочке.

**web (`test/`):**
- `UnitConfig` (или носитель бейджа) показывает тип сущности; при отсутствии `type` бейджа нет.

**Golden:** регенерируется (не байт-идентичен — ожидаемо).

## Риски
- **Изменение golden** — ожидаемое и проверяемое (диффом видно только добавление `type`). Не мискомпиляция.
- **Расширение condition-scope задевает cost/constraint-модификаторы** — их гейты со scope unit/upgrade/model теперь резолвятся движком на реальных узлах; аддитивно, не мискомпиляция. Сами лимиты (`map_constraint`) не расширяются.
- **Пере-скрытие в no-owner** — исключено включением четырёх scope в `CONTEXT_SCOPES`.
- **Перф** — `nearestByType` — линейный подъём по предкам, дёшево.
