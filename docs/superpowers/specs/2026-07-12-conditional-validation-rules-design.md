# Дизайн: условные правила валидации (`field="error"` модификаторы)

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[engine-parser-status]], `2026-07-11-conditional-visibility.md`, `2026-07-12-conditional-group-limits-design.md`

## Проблема

BattleScribe кодирует авторские правила валидации как модификаторы `<modifier type="add" value="<сообщение>" field="error">` с условиями. Когда гейт выполняется, выбор **невалиден** с этим дизайнерским сообщением. Примеры из реального SM:
- `value="Max 1 {this} per 5 models"` — гейт `(юнит <10 моделей) И (>1 этого оружия)`.
- `value="Must upgrade a weapon to a Crusade Relic"` — гейт из двух `selections`-условий.

Сейчас `map_entry` не знает `field="error"` → он падает в финальный `else` и дропается как `modifier.target_unmapped` «matches no cost type or constraint». Движок **полностью игнорирует эти правила** → билдер не показывает реальные ограничения GW (напр. «Max 1 per 5 models»). На реальном SM: **14 уникальных** error-правил (инлайнятся в ~1400 `target_unmapped`), условия почти все маппятся (comparators lessThan/atLeast/greaterThan, scopes root-entry/unit — поддержаны), кроме 2 GUID-scope.

## Механизм и зеркальность видимости

Error-правило структурно идентично hidden-модификатору: `{значение, условия}`, гейтуется теми же `passesGate`. Отличие: значение — **строка-сообщение** (не `bool set`), и срабатывание даёт **error-issue**, а не скрытие. Поэтому срез зеркалит инфраструктуру видимости (срез A+B/C), переиспользуя `map_condition`/`map_condition_group_strict` (парсер) и `passesGate` (движок).

## Инвариант «никогда не пере-энфорсить» (строгий all-or-nothing)

Error-правило **отвергает армию**, поэтому ложное срабатывание — худший исход. Правило мапится **только если ВСЕ его условия/группы маппятся** (строго, через `?`-пропагацию `None`, как `map_visibility_modifier`); иначе — весь модификатор дропается (`modifier.error_condition_unmapped`) и правило просто не энфорсится (безопасный недо-энфорс, никогда ложно не отвергаем). Так 2 GUID-scope error-правила корректно отбрасываются.

Только `type="add"` (append error) маппится; иной `type` на `field="error"` → `modifier.error_type_unsupported` + дроп (в реальных данных все 14 — `add`).

## Скоуп

**Делаем:** `field="error"`, `type="add"` → правило валидации `{message, conditions?, conditionGroups?}` на `IrEntry`; движок эмитит error-issue при выполнении гейта; подстановка токена `{this}` → имя сущности.

**НЕ делаем:** прочие `field="error"` типы (дроп с диагностикой); токены кроме `{this}` (оставляем литералом); веб-правки (issues уже рендерятся в `App.tsx:59-63` с цветом по severity).

## Слои

### 1. domain (`packages/domain/src/`)
- Новый `validation.ts` (зеркало `visibility.ts`):
  ```ts
  export const IrValidationRule = z.object({
    message: z.string(),
    conditions: z.array(IrCondition).optional(),
    conditionGroups: z.array(IrConditionGroup).optional(),
  });
  ```
- `ir.ts` `IrEntry` += `validationRules?: IrValidationRule[]` (interface, строка ~69) и Zod-поле `validationRules: z.array(IrValidationRule).default([])` (зеркало `visibilityModifiers`).

### 2. parser (`packages/engine-parser/src`)
- `ir/model.rs`: `IrValidationRule { message: String, #[serde skip-if-None] conditions, condition_groups }` (camelCase); `IrEntry` += `#[serde(skip_serializing_if = "Vec::is_empty")] pub validation_rules: Vec<IrValidationRule>` (зеркало `visibility_modifiers`).
- `ir/map.rs`:
  - Новый `map_validation_rule(m: &RawModifier, cat: &RawCatalogue) -> Option<IrValidationRule>` — точная копия `map_visibility_modifier`, но `message: m.value_raw.clone()` вместо `set: m.value_raw == "true"`.
  - В цикле модификаторов `map_entry` (после ветки `field == "hidden"`, перед cost/constraint-ветками):
    ```rust
    if m.field == "error" {
        if m.kind == "add" {
            match map_validation_rule(m, cat) {
                Some(vr) => validation_rules.push(vr),
                None => diags.push(Diagnostic { code: "modifier.error_condition_unmapped".into(),
                    message: format!("error modifier on entry {} has an unmappable condition (dropped)", e.id) }),
            }
        } else {
            diags.push(Diagnostic { code: "modifier.error_type_unsupported".into(),
                message: format!("error modifier on entry {} has unsupported type {} (dropped)", e.id, m.kind) });
        }
        continue;
    }
    ```
  - `let mut validation_rules: Vec<IrValidationRule> = Vec::new();` рядом с `visibility_modifiers`; добавить `validation_rules` в конструктор `IrEntry`.

### 3. engine-eval (`packages/engine-eval/src`)
- Новый `validation.ts`:
  ```ts
  export function validationIssues(node: EvalNode, state: EvalState): Issue[] {
    const out: Issue[] = [];
    for (const rule of node.entry.validationRules ?? []) {
      if (passesGate(rule.conditions, rule.conditionGroups, node, state)) {
        out.push({
          severity: "error",
          code: "selection.invalid",
          message: rule.message.replaceAll("{this}", node.entry.name),
          selectionId: node.selectionId,
          entryId: node.entry.id,
        });
      }
    }
    return out;
  }
  ```
- `evaluate.ts`: в цикле `for (const node of state.all)` — `raw.push(...validationIssues(node, state))`. Правило гейтуется на **реальном узле** (owner/предки реальны, как `nodeHiddenByState`).

### 4. cross-language contract
Тест: сущность в форме сериализации парсера с `validationRules:[{message, conditions}]` — валидируется Zod и при выполнении гейта `evaluate()` даёт error-issue с подставленным `{this}`; при невыполнении — нет issue.

## Инвариант «никогда не мискомпилировать»
- Golden байт-идентичен (mini-фикстура error-модификаторов не содержит → `validation_rules` пуст → skip-serialized).
- Строгий all-or-nothing: правило энфорсится только при полностью маппящемся гейте; иначе дроп → никогда ложно не отвергаем.
- `passesGate` тотален (`scopeNodes` не бросает при отсутствии якоря — фикс прошлых срезов) → `evaluate()` не падает.
- Гейт на реальном узле (не синтетическом) → контекст-scopes резолвятся по фактической цепочке.

## Тесты
**domain (`test/ir.test.ts` / `test/validation.test.ts`):** `IrValidationRule` парсит message+conditions; `IrEntry` без `validationRules` → `[]`.
**parser (`tests/map.rs`):**
- `field="error" type="add"` с маппящимся условием → `validation_rules=[{message,…}]`, нет `target_unmapped`.
- error-модификатор с немаппящимся условием (GUID-scope) → дроп (`modifier.error_condition_unmapped`), правило отсутствует.
- `field="error"` с `type` ≠ `add` → `modifier.error_type_unsupported` + дроп.
- Golden байт-идентичен.
**engine-eval (`test/validation.test.ts`):**
- гейт проходит → error-issue `selection.invalid`, `{this}` подставлен именем; `valid=false`.
- гейт не проходит → нет issue.
- правило без условий (безусловное) → issue всегда (edge).
**cross-language (`test/parser-contract.test.ts`):** parser-shaped `validationRules` валидируется Zod + энфорсится в `evaluate()`.

## Осязаемо
Реальный SM: `modifier.target_unmapped` **2198 → ~800** (уходит ~1400 error-инстансов; остаток — `category`-field модификаторы). ~12 авторских правил валидации («Max 1 per 5 models» и т.п.) энфорсятся: при нарушении билдер показывает дизайнерское сообщение красным (`App.tsx` severity-рендер), ростер невалиден.
