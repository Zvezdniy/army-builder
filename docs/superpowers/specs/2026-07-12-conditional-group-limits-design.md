# Дизайн: условные групповые лимиты (modifier-on-limit)

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[engine-parser-status]], `2026-07-12-roster-scope-group-limits-design.md`, `2026-07-12-constraint-context-scopes-design.md`, `2026-07-11-group-choose-n.md`

## Проблема

`selectionEntryGroup` может нести на своём min/max лимите **модификатор** — правило, меняющее сам лимит при условии (`set`/`increment`/`decrement`, гейт из conditions). Классический паттерн 40k — «per-model allowance»: `increment value=1` к min И max группы, гейт `atLeast 1 model-or-unit childId=<sergeant> includeChildSelections` («+1 к разрешённому за каждого сержанта»). Сейчас `map_group_constraint` встречает модификатор на лимите (`g.modifiers.iter().any(|m| m.field == c.id)`) и **дропает весь групповой constraint** → **973** `group.constraint_dropped` «has a modifier on its limit». Это весь остаток бакета `group.constraint_dropped` (крупнейший когерентный enforcement-пробел после roster-scope).

## Ключевое наблюдение: entry-путь уже готов, групповой — зеркало

- **Entry-констрейнты с modifier-on-limit уже работают end-to-end.** `map_entry` (map.rs:106) кладёт модификатор в `c.modifiers`; `IrConstraint.modifiers` сериализуется; engine-eval `effectiveConstraintValue` (constraints.ts:7) → `applyModifiers(constraint.value, constraint.modifiers, node, state)` даёт эффективный лимит перед сравнением. `applyModifiers` (modifiers.ts) полностью generic: `set`/`increment`/`decrement`, каждый гейтуется `gatePasses(modifier, node, state)`.
- **Групповой путь — единственный симметричный пробел:** `IrGroupConstraint` не имеет поля `modifiers`, поэтому `map_group_constraint` не может их прикрепить и дропает весь constraint; `checkGroupConstraint` сравнивает с сырым `gc.value`.
- Условия реальных данных (`atLeast`/`model-or-unit`/`selections`) **полностью маппятся** существующим `map_condition` (все нужные context-scopes добавлены прошлыми срезами) и исполняются существующим `gatePasses`. Новой condition-инфраструктуры не требуется.

Срез = протянуть `modifiers` на `IrGroupConstraint` и применять их в `checkGroupConstraint`, **точно повторяя** entry-констрейнты.

## Инвариант «никогда не мис-энфорсить» (строгий all-or-nothing)

Групповой лимит-модификатор энфорсится **только если всё правило маппится целиком** — база + каждый модификатор + все его условия. Если хоть что-то немаппится — **дропаем весь групповой constraint** (как сегодня: нулевой энфорсмент, громкий диагностик). Никакого частичного маппинга.

Почему строго (в отличие от entry-пути, который лениво роняет отдельные условия — pre-existing, вне скоупа):
- Немаппящееся условие на лимит-модификаторе делает гейт **функционально отсутствующим** → модификатор применяется чаще, чем должен. Для `increment`-на-`max` это либеральнее (недо-энфорс, легальную армию не блокирует), но для `increment`-на-`min` или `decrement` — может **пере-энфорсить** (отклонить легальную армию). Направление ошибки зависит от типа/условия, поэтому единственный безопасный выбор — **всё или ничего**.
- Дроп всего constraint при немаппящемся правиле = откат к сегодняшнему поведению (нет энфорса) → мы **никогда не вводим** ни пере-, ни недо-энфорс сверх статус-кво. Либо энфорсим полное условное правило верно, либо не энфорсим вовсе.

**roster-scope + modifier-on-limit → дроп (документированное ограничение).** Гейт модификатора owner-относителен (условие «на этом юните есть сержант»), а roster-scope лимит армейский; корректно заякорить owner-гейт на армейское правило нельзя. Такой constraint дропаем громко (существующий код уже маппит scope до проверки модификатора — добавляем явную ветку). В реальных данных modifier-on-limit — это per-model allowances, все self-scope; roster+modifier — маргинальный/отсутствующий кейс.

## Скоуп

**Делаем:** `self`-scope групповой min/max с полностью маппящимися лимит-модификаторами (`set`/`increment`/`decrement`, условия/группы условий). Модификатор мапится **строго** (немаппящееся условие ИЛИ `repeats` → всё правило дропается).

**НЕ делаем:** roster-scope + modifier (дроп, документировано); ужесточение entry-констрейнт пути (pre-existing лениво, отдельный consistency-долг); не-selections/не-min-max группы (по-прежнему дроп как раньше).

## Слои

### 1. domain (`packages/domain/src/ir.ts`)
`IrGroupConstraint` += `modifiers: z.array(IrModifier).optional()` (зеркало `IrConstraint`, ir.ts:21). `IrModifier` уже импортируется. Опционально → обратная совместимость (IR без поля читается как «нет модификаторов»).

### 2. parser (`packages/engine-parser/src`)
- `ir/model.rs`: `IrGroupConstraint` += `#[serde(skip_serializing_if = "Option::is_none")] pub modifiers: Option<Vec<IrModifier>>` (зеркало `IrConstraint`, model.rs:96-97). `IrGroupConstraint` получает `#[serde(rename_all = "camelCase")]`? — нет: у него нет multi-word полей кроме нового `modifiers` (одно слово), остальные (`id`/`type`/`value`/`scope`) уже прямые; `modifiers` сериализуется как `modifiers`. Golden байт-идентичен (mini-фикстура групповых модификаторов не имеет → поле `None` → skip).
- `ir/map.rs`:
  - Новый строгий маппер `map_modifier_strict(m: &RawModifier, owner_id: &str, index: usize, cat: &RawCatalogue) -> Option<IrModifier>` — как `map_modifier`, НО all-or-nothing по условиям и `return None`, если: `m.has_repeats`; ИЛИ число смапленных условий < числа сырых (`map_condition` уже возвращает `Option` — считаем `Some`-результаты и сверяем с `m.conditions.len()`, отдельный «строгий map_condition» не нужен); ИЛИ любая группа-условий немаппится (через `map_condition_group_strict`, как в видимости). Диагностики внутренних попыток отбрасываются (у строгого маппинга свой один диагностик от вызывателя). Возвращает `Some(IrModifier)` только при полном маппинге всех условий и групп.
  - `map_group_constraint(c, g, cat, diags)` (+`cat: &RawCatalogue`): вычислить `has_limit_mod = g.modifiers.iter().any(|m| m.field == c.id)`.
    - Порядок: после проверок kind/field/scope (как сейчас). Если `has_limit_mod`:
      - `scope == "roster"` → `diags.push(drop("roster-scope limit carries a modifier (unsupported)"))`; `return None`.
      - иначе (`self`): собрать `g.modifiers.iter().enumerate().filter(|(_,m)| m.field == c.id)`, смапить каждый через `map_modifier_strict(m, &g.id, index, cat)`. Если **все** `Some` → `modifiers = Some(vec)`. Если хоть один `None` → `diags.push(drop("has an unmappable modifier on its limit"))`; `return None`.
    - Если `!has_limit_mod` → `modifiers = None` (как сегодня).
  - `Some(IrGroupConstraint { id, type_, value, scope, modifiers })`.
  - Вызыватель `map_group` (map.rs:170) передаёт `cat`.

### 3. engine-eval (`packages/engine-eval/src/groups.ts`)
`checkGroupConstraint(gc, node, group, state)`: заменить сырое `gc.value` в сравнении и сообщении на эффективный лимит:
```ts
import { applyModifiers } from "./modifiers";
const limit = applyModifiers(gc.value, gc.modifiers, node, state);
const violated = gc.type === "max" ? actual > limit : actual < limit;
// message использует limit вместо gc.value
```
`node` (владелец группы) корректно якорит owner-относительный гейт. Для roster-scope `gc.modifiers` всегда `undefined` (парсер дропает roster+modifier) → `applyModifiers` вернёт базу → поведение roster-пути неизменно, dedup в evaluate.ts не затрагивается.

### 4. cross-language contract
e2e: распарсенный IR-групповой constraint с условным `increment`-модификатором — при выполнении гейта эффективный max поднимается и «лишний» член разрешён; при невыполнении — база энфорсится (нарушение).

## Тесты

**domain (`test/ir.test.ts`):** `IrGroupConstraint` парсит `modifiers:[…]`; без поля → `undefined`.

**parser (`tests/map.rs`):**
- self-scope групповой constraint с `increment`-модификатором на его id, условие маппится → эмитится с `modifiers=[…]`, нет `group.constraint_dropped`.
- модификатор на лимите с **немаппящимся** условием (напр. неизвестный comparator/scope) → constraint дропнут (`group.constraint_dropped` «unmappable modifier»), не эмитится.
- модификатор с `repeats` → дроп.
- roster-scope + модификатор → дроп («roster-scope … carries a modifier»).
- self-scope БЕЗ модификатора → `modifiers` не сериализован (skip), поведение как раньше.

**engine-eval (`test/groups.test.ts`):**
- `increment value=1` на max=0, гейт проходит (владелец несёт нужный член) → эффективный max=1, 1 выбран → valid; 2 выбрано → `group.max` (сообщение «exceeds max 1»).
- тот же модификатор, гейт НЕ проходит → база max=0 энфорсится, 1 выбран → `group.max` («exceeds max 0»).
- `set`-модификатор поднимает лимит; `decrement` опускает.
- constraint без модификаторов (`gc.modifiers` undefined) — поведение прежнее.

**evaluate (`test/evaluate.test.ts`):** e2e условный групповой лимит: гейт от реального состояния владельца поднимает/не поднимает max, соответствующий issue появляется/исчезает.

**Golden:** байт-идентичен (mini-фикстура групповых лимит-модификаторов не содержит).

## Осязаемо

Реальный SM: `group.constraint_dropped` **973 → ~остаток** (остаток = roster+modifier маргинальные кейсы, если есть, + любые немаппящиеся; ожидаем близко к 0). Per-model allowances («+1 вещь за сержанта», «Combi-weapon только если…») энфорсятся в билдере: превышение условного лимита даёт `group.max`/`group.min`, изменение состава меняет доступный предел вживую.
