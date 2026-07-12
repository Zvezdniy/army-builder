# Дизайн: условное членство в категории (`field="category"` модификаторы)

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[engine-parser-status]], `2026-07-12-conditional-validation-rules-design.md`, `2026-07-11-conditional-visibility.md`

## Проблема

BattleScribe `<modifier type="add" value="<category-id>" field="category">` с условиями = **условное членство в категории**: сущность получает категорию (ключевое слово), когда гейт выполняется. Пример реального SM: «+категория `b6a1-…` если в ростере есть детачмент Headhunter Task Force» (`atLeast 1` selections roster). Разбивка (реальный SM, 199 уникальных): **196 `add`**, 2 `set-primary`, 1 `remove`; значение всегда — GUID категории. Сейчас `map_entry` не знает `field="category"` → дроп как `modifier.target_unmapped` (754 после инлайнинга). Движок считает по **статическому** членству (`entry.categories`), пропуская условно-добавленные категории. Это тихо искажает всё, что агрегирует по категориям: force-org лимиты (`targetType=category`) и условия `instanceOf` категории.

## Механизм и точка интеграции

Ключ: `EvalNode.categories` (state.ts:11) **уже отделён** от `entry.categories`, и весь downstream-подсчёт по категориям читает `node.categories` (`matchesTarget`, scopes.ts:107). Значит интеграция локализована: вычислить **эффективное** членство `static ∪ added(гейт) \ removed(гейт)` и записать в `node.categories` одним шагом; ни `aggregate`, ни constraints/conditions менять не нужно.

## Инвариант «никогда не мис-энфорсить» (строгий all-or-nothing)

Условно-добавленная категория может заставить `max N of category` **впервые сработать** (отвергнуть армию) — это корректно, ЕСЛИ добавление верно. Поэтому категория-модификатор мапится **только при полностью маппящемся гейте** (строго, `?`-пропагация как `map_visibility_modifier`); иначе — весь модификатор дропается (`modifier.category_condition_unmapped`), членство не меняется (безопасный статус-кво). Никогда частично → никогда ложно не добавляем/не убираем категорию.

`set-primary` (2) не влияет на **членство** (только на то, какая категория первичная — display-семантика BattleScribe, сущность уже линкует категорию) → дроп с диагностикой `modifier.category_set_primary_unsupported`. Неизвестный `type` → дроп.

## Детерминизм и порядок (single-pass)

Гейты категория-модификаторов оцениваются **против статического членства** (все узлы ещё несут `entry.categories`) единым проходом «вычислить всё → записать всё» (не in-place по ходу), чтобы результат не зависел от порядка узлов. Реальные гейты проверяют **выбор детачмента** (selections/instanceOf), а не условно-добавленные категории, поэтому один проход точен. Известное ограничение (документируется): гейт, зависящий от ДРУГОЙ условно-добавленной категории, увидит её статическое состояние (не итерируем до неподвижной точки — в отличие от очков; в реальных данных таких цепочек нет).

Порядок в `evaluate()`: `buildState` → **`resolveCategories`** → `resolveCosts` → constraints/conditions. Так условно-добавленные категории видны и cost-резолюции, и всем лимитам/условиям/видимости/валидации. (Гейт категории с `field="points"` увидит базовые очки — приемлемо, как и прочие costOf-непроброшенные гейты; реальные гейты на selections.)

## Скоуп

**Делаем:** `field="category"` `type`∈{`add`,`remove`} → `IrCategoryModifier {type, categoryId, conditions?, conditionGroups?}` на `IrEntry`; движок вычисляет эффективное членство и пишет в `node.categories`. Строгий all-or-nothing гейт.

**НЕ делаем:** `set-primary` (дроп, display-семантика); итерация до неподвижной точки по категориям (single-pass); веб-правки (членство влияет на уже отображаемые issues/лимиты).

## Слои

### 1. domain (`packages/domain/src/`)
- Новый `category-modifiers.ts`:
  ```ts
  export const IrCategoryModifier = z.object({
    type: z.enum(["add", "remove"]),
    categoryId: z.string(),
    conditions: z.array(IrCondition).optional(),
    conditionGroups: z.array(IrConditionGroup).optional(),
  });
  ```
- `ir.ts` `IrEntry` += `categoryModifiers?: IrCategoryModifier[]` (interface) и `categoryModifiers: z.array(IrCategoryModifier).default([])` (Zod). Экспорт из index.

### 2. parser (`packages/engine-parser/src`)
- `ir/model.rs`: `IrCategoryModifier { #[serde rename="type"] type_: String, category_id: String, #[skip-if-None] conditions, condition_groups }` (camelCase); `IrEntry` += `#[serde(skip_serializing_if = "Vec::is_empty")] pub category_modifiers: Vec<IrCategoryModifier>`.
- `ir/map.rs`:
  - Новый `map_category_modifier(m, cat) -> Option<IrCategoryModifier>` — строгий (копия структуры `map_validation_rule`), `category_id: m.value_raw.clone()`, `type_: m.kind.clone()` (только `add`/`remove` доходят сюда).
  - Ветка в цикле модификаторов `map_entry` (после `field == "error"`, перед cost/constraint), `continue`:
    ```rust
    if m.field == "category" {
        match m.kind.as_str() {
            "add" | "remove" => match map_category_modifier(m, cat) {
                Some(cm) => category_modifiers.push(cm),
                None => diags.push(Diagnostic { code: "modifier.category_condition_unmapped".into(),
                    message: format!("category modifier on entry {} has an unmappable condition (dropped)", e.id) }),
            },
            "set-primary" => diags.push(Diagnostic { code: "modifier.category_set_primary_unsupported".into(),
                message: format!("set-primary category modifier on entry {} does not affect membership (dropped)", e.id) }),
            other => diags.push(Diagnostic { code: "modifier.category_type_unsupported".into(),
                message: format!("category modifier on entry {} has unsupported type {} (dropped)", e.id, other) }),
        }
        continue;
    }
    ```
  - `let mut category_modifiers: Vec<IrCategoryModifier> = Vec::new();` + в конструктор `IrEntry`.

### 3. engine-eval (`packages/engine-eval/src`)
- Новый `categories.ts`:
  ```ts
  export function effectiveCategories(node: EvalNode, state: EvalState): string[] {
    const set = new Set(node.entry.categories);
    for (const cm of node.entry.categoryModifiers ?? []) {
      if (!passesGate(cm.conditions, cm.conditionGroups, node, state)) continue;
      if (cm.type === "add") set.add(cm.categoryId);
      else set.delete(cm.categoryId);
    }
    return [...set];
  }
  // Two-phase (compute-all-then-assign) so gate evaluation reads static membership
  // uniformly and the result is order-independent.
  export function resolveCategories(state: EvalState): void {
    const computed = state.all.map((n) => effectiveCategories(n, state));
    state.all.forEach((n, i) => { n.categories = computed[i]!; });
  }
  ```
- `evaluate.ts`: сразу после `const state = buildState(...)` вызвать `resolveCategories(state);` (перед `resolveCosts`). Импорт из `./categories`.
- `state.ts` без изменений структуры (`node.categories = entry.categories` остаётся начальным; `resolveCategories` присваивает НОВЫЙ массив, `entry.categories` не мутируется — важно, т.к. shared у инлайненных дублей).

### 4. cross-language contract
Тест: parser-shaped сущность с `categoryModifiers:[{type:"add", categoryId, conditions}]` — при выполнении гейта узел приобретает категорию, и force-`max` по этой категории впервые нарушается (issue появляется); без гейта — членство статично (нет issue). Валидируется `IrCatalogue.parse`.

## Инвариант «никогда не мискомпилировать»
- Без категория-модификаторов `effectiveCategories` = статический набор → `node.categories` идентичен → существующее поведение неизменно (0 регрессий; проверяется тестом).
- `entry.categories` НИКОГДА не мутируется (новый массив) → shared у инлайненных дублей не портится.
- Строгий гейт → категория меняется только при верном полном маппинге.
- `resolveCategories` до `resolveCosts` → условные категории видны всему downstream.
- Golden байт-идентичен (mini-фикстура category-модификаторов не содержит → `category_modifiers` пуст → skip).

## Тесты
**domain:** `IrCategoryModifier` парсит; `IrEntry` без поля → `[]`.
**parser (`tests/map.rs`):** `add` с маппящимся условием → `category_modifiers=[…]`, нет `target_unmapped`; немаппящееся условие → дроп `category_condition_unmapped`; `set-primary` → `category_set_primary_unsupported`; golden байт-идентичен.
**engine-eval (`test/categories.test.ts`):**
- `add`-гейт проходит → `node.categories` содержит новую категорию; force-`max` по ней срабатывает → `constraint.max` issue, `valid=false`.
- гейт не проходит → членство статично, нет issue.
- `remove`-гейт проходит → категория убрана.
- узел без модификаторов → `node.categories` === статический (регрессионный инвариант).
**cross-language (`test/parser-contract.test.ts`):** parser-shaped `categoryModifiers` валидируется Zod + условная категория меняет исход force-лимита.

## Осязаемо
Реальный SM: `modifier.target_unmapped` **801 → ~50** (уходит ~750 category-инстансов; остаток — `name`/прочие поля). Юниты, получающие категорию от детачмента (напр. Headhunter Task Force keyword), корректно учитываются в лимитах и условиях по этой категории → билдер энфорсит детачмент-зависимые правила.
