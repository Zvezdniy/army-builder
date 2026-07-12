# Дизайн: entryLink-hosted модификаторы (per-placement cost/constraint/error/category)

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[engine-parser-status]], `2026-07-12-entrylink-hosted-hidden-design.md`, `2026-07-12-conditional-group-limits-design.md`, `2026-07-12-conditional-validation-rules-design.md`, `2026-07-12-conditional-category-membership-design.md`

## Проблема

BattleScribe `<entryLink>` может нести собственные `<modifiers>`, применяемые к конкретной вставке общей сущности (per-placement). Срез entryLink-hosted-hidden научил парсер применять `field="hidden"` link-модификаторы (через дозапись в `resolved.modifiers`), но **все остальные** link-модификаторы (cost/constraint/error/category/name) громко дропаются (`entryLink.modifier_dropped`, 528 на реальном SM). Это оставляет per-placement переопределения (напр. другой лимит или цена конкретной вставки) неучтёнными.

**Реальный SM (528):** доминируют `b03b` = «Crusade Points» costType (381, нарративный режим — не matched-play) и `c0ea` = constraint (127, per-placement лимит-оверрайд на **group**-ссылках — matched-play), плюс name/error/прочее.

## Ключевое наблюдение: роутинг уже построен

`resolve_entry`/`resolve_group` возвращают **уникальный per-placement клон** цели (`out = target.clone()`), сохраняя `out.modifiers`. Downstream уже умеет роутить модификаторы сущности/группы:
- `map_entry` (ir/map.rs): `field="hidden"`→visibility, cost-type→`cost.modifiers`, `field="error"`→validation rule, `field="category"`→category modifier, constraint-id→`constraint.modifiers`, иначе→`modifier.target_unmapped`.
- `map_group_constraint` (срез conditional-group-limits): модификатор на групповом лимите (`m.field == constraint.id`) строго маппится и прикрепляется.

Значит фикс = **дозаписать модификаторы ссылки в `resolved.modifiers`** (как уже делается для hidden), и весь существующий строгий роутинг обработает их единообразно — как если бы цель несла эти модификаторы на данной вставке. Per-placement клон гарантирует отсутствие утечки на общую цель.

## Скоуп

**Делаем:**
- **entry-ссылка:** дозаписать ВСЕ модификаторы ссылки в `resolved(entry).modifiers`; `map_entry` роутит (cost/constraint/hidden/error/category; нерепрезентируемые, напр. `name` или Crusade-cost без эмитируемой стоимости → `modifier.target_unmapped`, корректная рекатегоризация).
- **group-ссылка:** дозаписать НЕ-hidden модификаторы в `resolved(group).modifiers`; `map_group_constraint` прикрепляет совпадающие лимит-модификаторы (per-placement constraint-оверрайд, c0ea). Hidden на group-ссылке (статический `hidden` ИЛИ `field="hidden"` модификатор) по-прежнему `entryLink.group_hidden_unsupported` (видимость групп не моделируется).

**НЕ делаем:** моделирование `field="name"` (условная смена имени — отдельный механизм; уходит в `target_unmapped`); групповую видимость; изменение самих downstream-роутеров (они готовы).

## Слои

### parser (`packages/engine-parser/src/resolve/links.rs`)
1. **`apply_link_visibility` → `apply_link_modifiers`** (entry-ветка, ~line 148): вместо «hidden→push, иначе→drop» — **push ВСЕХ** `link.modifiers` в `resolved.modifiers`; статический `link.hidden` → `resolved.hidden = true` (без изменений). Убрать drop-ветку и её диагностик.
2. **group-ветка `resolve_link`** (~line 102-125): сделать `resolved` мутабельным; после `resolve_group`:
   - статический `link.hidden` ИЛИ любой `field="hidden"` модификатор → `entryLink.group_hidden_unsupported` (как сейчас).
   - дозаписать НЕ-hidden модификаторы (`m.field != "hidden"`) в `resolved.modifiers` (вместо drop-цикла).
   - `groups.push(resolved)`.

Downstream (`map_entry`, `map_group`/`map_group_constraint`) НЕ трогаем — они уже роутят строго.

## Инвариант «никогда не мис-энфорсить / не мискомпилировать»
- Per-placement клон (`target.clone()`) → дозаписанные модификаторы не текут на общую цель (уже гарантия hidden-среза).
- Модификаторы проходят ТОТ ЖЕ строгий роутинг, что и собственные модификаторы сущности/группы (cost — как cost.modifiers; constraint — строгий `map_constraint`/`map_group_constraint` all-or-nothing; error/category/hidden — строгие мапперы). Никакой новой семантики.
- Нерепрезентируемое поле (name, Crusade-cost) → `modifier.target_unmapped` (то же, что для собственного модификатора цели с таким полем) — рекатегоризация, не тихий дроп.
- Golden байт-идентичен (mini-фикстура link-модификаторов кроме hidden не содержит → `resolved.modifiers` пуст для не-hidden → без изменений сериализации).

## Тесты
**parser (`tests/map.rs` / `tests/resolve.rs`):**
- entry-ссылка с cost-модификатором (`field=<costType>`) → у инлайненной вставки `cost.modifiers` содержит его; нет `entryLink.modifier_dropped`.
- entry-ссылка с constraint-модификатором (`field=<constraint-id цели>`) → `constraint.modifiers` вставки содержит его.
- entry-ссылка с `field="hidden"` → по-прежнему visibility (регресс hidden-среза не сломан).
- entry-ссылка с нерепрезентируемым полем (`field="name"`) → `modifier.target_unmapped` (не `entryLink.modifier_dropped`).
- group-ссылка с модификатором на групповом лимите (`field=<group-constraint-id>`, self-scope) → групповой constraint вставки несёт `modifiers` (через conditional-group-limits машину).
- group-ссылка с `field="hidden"` → `entryLink.group_hidden_unsupported` (без изменений).
- **per-placement изоляция:** общая сущность, залинкованная в ДВА места, одно с cost-модификатором — модификатор только на одной вставке, вторая не тронута (клон не течёт).
- Golden байт-идентичен.

**cross-language (`packages/engine-eval/test/parser-contract.test.ts`):** распарсенная сущность с entry-link cost-модификатором → `evaluate()` даёт разную стоимость на двух вставках (per-placement pricing работает end-to-end через уже готовый `applyModifiers` в cost-резолюции).

## Осязаемо
Реальный SM: `entryLink.modifier_dropped` **528 → ~0** (Crusade-cost рекатегоризируется в `target_unmapped`; constraint-оверрайды c0ea и per-placement cost/error/category — применяются). Завершает entryLink-hosted-модификаторную арку (отложенный «pricing-срез»); per-placement переопределения (цена/лимит конкретной вставки общего оружия/усиления) теперь учитываются в билдере.
