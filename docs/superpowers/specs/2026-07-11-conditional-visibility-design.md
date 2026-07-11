# Дизайн: условная видимость (`hidden` + instanceOf) — срез A+B

**Дата:** 2026-07-11
**Статус:** утверждён к реализации
**Связано:** [[engine-parser-status]], [[real-catalogue-web-probe]], [[roster-web-status]] (S2-гейтинг)

## Проблема

Крупнейший пласт нераспознанных конструкций реального каталога — гейтинг **видимости**: `instanceOf`/`notInstanceOf` условия (≈54k после инлайна) и `hidden`-модификаторы (≈25k, код `modifier.target_unmapped`). Из-за этого билдер показывает опции, которые не должны быть доступны при текущем детачменте/состоянии армии (усиления не того детачмента, [Legends]-юниты и т.п.). Парсер `hidden` не читает вовсе.

**Наблюдения (счёт по .cat до инлайна):** 482/485 `hidden`-модификаторов — `set value="true"` **при** условии (скрыть-когда), 3 — show-when; статический `hidden="true"` почти не встречается (1 entry). Scopes hidden-условий: roster 47, parent 28, root-entry 13, primary-catalogue 13, self 8, force 6, ancestor 6, прочие. engine-eval уже умеет self/parent/force/roster.

## Скоуп (срез A+B, поддержанные scopes)

**Делаем:** static `hidden` + условный `hidden` через `instanceOf/notInstanceOf` и scopes **self/force/roster**, end-to-end до скрытия опций в вебе.

**НЕ делаем (отдельные срезы):**
- Новые/контекст-зависимые scopes `parent`/`root-entry`/`ancestor`/`primary-catalogue`/`unit`/`upgrade` (срез C). Условие hidden-гейта с таким scope → hidden-модификатор дропается целиком, узел видим. **`parent` отложен вместе с ними:** видимость в этом срезе вычисляется для НЕвыбранных опций через синтетический self-узел, у которого нет реального родителя, поэтому parent нельзя вычислить достоверно — безопаснее отложить, чем приблизить и пере-скрыть.
- Вычисление hidden уже **выбранных** узлов — отложено (безопасно видимы). Для опций работают static + roster/force + self.
- **entryLink-hosted hidden** — отложено. `RawEntryLink` хранит только `target_id`/`link_type`; `<modifiers>` и `hidden` на самих `<entryLink>` сейчас не парсятся, а резолв инлайнит цель, игнорируя атрибуты ссылки. Их подхват требует плумбинга в raw+resolve — отдельный срез. Этот срез берёт hidden-модификаторы на **`<selectionEntry>`** (именно они дают 25k `modifier.target_unmapped hidden` — модификаторы инлайненных shared-сущностей) + static `hidden` на selectionEntry/selectionEntryGroup.
- Прочие цели модификаторов (`category`, `error`, `name`) — вне скоупа.

## Инвариант «никогда не пере-скрывать»

Скрыть валидную опцию хуже, чем показать лишнюю. Поэтому: hidden-модификатор попадает в IR **только если ВСЕ его условия/группы-условий маппятся** (comparator ∈ {existing, instanceOf, notInstanceOf}, scope ∈ {self, force, roster}, field маппится). Если хоть одно условие немаппится (в т.ч. scope `parent`/`root-entry`/`ancestor`/`primary-catalogue`/…) — дропаем **весь модификатор** с диагностикой (`modifier.hidden_condition_unmapped`), и сущность остаётся видимой. Никогда не дропаем отдельное условие внутри hidden-гейта (это ослабило бы гейт и пере-скрыло).

## Слои

### 1. Parser (`engine-parser`)
- `RawEntry`/`RawGroup` получают `hidden: bool` — читать атрибут `hidden="true"` у `<selectionEntry>`, `<entryLink>`, `<selectionEntryGroup>` (Start и Empty).
- `RawModifier` получает `value_raw: String` (нераспарсенный атрибут `value`), т.к. для `hidden` значение — `"true"/"false"`, а не число (текущий `value: f64` даёт 0.0).
- `map_condition`: добавить comparator `instanceOf` → `(comparator="atLeast", value=1)`, `notInstanceOf` → `(comparator="lessThan", value=1)`. Реюз существующих engine-eval компараторов; изменение аддитивно (помогает и не-hidden условиям — это ок).
- В `map_entry`: модификаторы с `field=="hidden"` НЕ идут в ветку cost/constraint (не диагностируются `modifier.target_unmapped`). Вместо этого — строгий маппинг в `IrEntry.visibility_modifiers`: `{ set: value_raw=="true", conditions, condition_groups }`, по инварианту «все условия маппятся (scope ∈ {self,force,roster}) или дроп всего модификатора». Строгий маппинг условий hidden отдельный от лёгкого (filter_map) маппинга условий cost/constraint-модификаторов — там дроп отдельного условия допустим по существующему дизайну.
- `IrEntry.hidden` из `RawEntry.hidden` (serde skip-if-false).
- Golden mini40k — байт-идентичен (нет hidden/instanceOf в фикстуре).

### 2. Domain/IR (`@muster/domain`)
- `IrEntry.hidden?: boolean` (default false), `IrEntry.visibilityModifiers?: VisibilityModifier[]`.
- `VisibilityModifier = { set: boolean, conditions?: IrCondition[], conditionGroups?: IrConditionGroup[] }` (Zod + Rust serde camelCase, зеркально).

### 3. engine-eval
- Новый `hiddenEntryIds(roster, catalogue): Set<string>`:
  - Строит `SymbolTable` + `EvalState` из ростера (как `evaluate`).
  - Для каждой сущности каталога с `visibilityModifiers` (обход символ-таблицы): строит **синтетический self-`EvalNode`** (effectiveCount=1, categories/entry сущности, children=[], parent=null); эффективный hidden = стартовый `entry.hidden`, затем для каждого visibility-модификатора: если `gatePasses(mod, synthNode, state)` — hidden = `mod.set`. roster/force-условия считаются по реальному `state.all`; self — по синтетическому узлу.
  - id сущностей с итоговым hidden=true → в set.
- Реюз `gatePasses`/`aggregate`; параметр `set` — булев исход, тип `VisibilityModifier` конвертируется в существующую условную оценку. Никаких изменений компараторов.

### 4. web (`apps/web`)
- `AddUnitPicker`: `availableUnits(catalogue)` фильтруется по `hiddenEntryIds(roster, catalogue)`.
- `UnitConfig`: `options` и члены групп (`memberEntryIds`) фильтруются по тому же set.
- `App` вычисляет set через `useMemo(hiddenEntryIds(roster, catalogue))` и прокидывает. roster-пакет не трогаем (фильтрует веб композицией — чистота roster сохранена).

## Тесты

**Parser (`tests/map.rs`, `tests/raw_parse.rs`):**
1. `hidden="true"` на entry → `IrEntry.hidden==true`.
2. hidden-модификатор `set true` c условием `instanceOf` scope=roster → `visibility_modifiers` содержит `{set:true, condition atLeast/1}`; НЕ `modifier.target_unmapped`.
3. hidden-модификатор с условием scope=`root-entry` (неподдержан) → модификатор дропнут целиком (`modifier.hidden_condition_unmapped`), `visibility_modifiers` пуст, entry видима.
4. `notInstanceOf` → `(lessThan,1)`.

**Domain:** Zod round-trip `IrEntry` с `hidden` + `visibilityModifiers`.

**engine-eval (`test/visibility.test.ts`):**
5. Сущность-усиление с visibility-модификатором `set hidden=true` при `notInstanceOf <detachment>` scope=roster: ростер БЕЗ детачмента → id в `hiddenEntryIds`; ростер С детачментом → НЕ в set.
6. Сущность без visibility-модификаторов и static hidden=false → никогда не в set.
7. Немаппящихся сущностей нет (парсер уже отфильтровал) — тест на пустой set при отсутствии модификаторов.

**web:** пикер не показывает скрытый юнит; конфиг не показывает скрытую опцию/член группы (jsdom).

**Golden:** без изменений.

**Осязаемо (руками):** реальный SM → `hiddenEntryIds` непустой; в билдере при выбранном детачменте не-подходящие усиления/опции исчезают; instanceOf-диагностики резко падают.

## Риски
- **Пере-скрытие** — исключено инвариантом: hidden-гейт с любым неподдержанным условием (в т.ч. scope `parent` и прочие контекст-зависимые) дропается целиком → сущность видима. engine-eval видит только scopes {self, force, roster}, все достоверно вычислимые на синтетическом self-узле (force/roster — по реальному `state.all`, self — по узлу).
- **Перф** `hiddenEntryIds` на реальном IR — обход только сущностей с visibility-модификаторами; синтетический узел дешёв; разово на изменение ростера (useMemo).
- **instanceOf value≠1** — редко; маппинг форсит value=1 (членство «есть ≥1»), т.к. instanceOf — флаг принадлежности, не порог.
- **Покрытие** — parent-scoped hidden-гейты (≈28 на .cat) в этом срезе не скрывают → останутся видимыми до среза C. Приемлемо и безопасно.
