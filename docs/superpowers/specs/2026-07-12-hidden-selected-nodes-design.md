# Дизайн: hidden выбранных узлов

**Дата:** 2026-07-12
**Статус:** утверждён к реализации
**Связано:** [[engine-parser-status]], `2026-07-11-conditional-visibility-design.md` (A+B), `2026-07-11-context-aware-visibility-design.md` (C-a)

## Проблема

`evaluate()` не смотрит на видимость. Узел, уже выбранный в ростере, чья эффективная видимость стала `hidden` при текущем состоянии ростера (напр. добавил Enhancement → сменил детачмент → он больше недоступен), молча остаётся: считается в очках, проходит валидацию, пользователь не предупреждён.

`hiddenEntryIds` решает смежную, но иную задачу — прячет **предлагаемые опции** (пикер/конфиг), строя *синтетические* узлы кандидатов (и потому вынуждена пропускать context-scopes без владельца). Для **уже выбранных** узлов владелец и предки реальны.

## Продуктовое решение (утверждено)

Скрытый выбранный узел → **warning** (неблокирующее). Ростер остаётся `valid`, узел **продолжает стоить очков** и участвовать в constraints (как «error selection» в BattleScribe существует и стоит очков до удаления). Мы только ДОБАВЛЯЕМ проблему; удаление — вручную существующей кнопкой.

**Уточнение (по итогам адверсариального ревью):** предупреждение только для **modifier-driven** скрытия — узел видим по определению (`entry.hidden` false), но модификатор скрыл его при текущем состоянии («стал недоступен»). **Статически-`hidden: true`** узлы ИСКЛЮЧЕНЫ: билдер авто-сидит обязательных (`min>=1`) скрытых детей без hidden-фильтра, это постоянные структурные части, а не «стало недоступно» — warning на них шумен и по смыслу неверен. `hiddenEntryIds` (фильтр опций пикера) по-прежнему чтит статический hidden.

## Инвариант

Видимость считается тем же строгим путём (`passesGate`), что и раньше. Поведение очков/constraints **не меняется** (never-miscompile). Для реальных узлов owner/предки всегда присутствуют → no-owner-skip НЕ нужен (в отличие от `hiddenEntryIds`).

## Слои

### 1. engine-eval (`packages/engine-eval/src`)
- `visibility.ts`:
  - Новый `nodeHidden(node: EvalNode, state: EvalState): boolean` — эффективный hidden реального узла: база `node.entry.hidden ?? false`, затем по порядку `node.entry.visibilityModifiers`; если `passesGate(m.conditions, m.conditionGroups, node, state)` → `isHidden = m.set`. Без no-owner-skip (узел реален).
  - Новый `hiddenSelectionIds(roster: Roster, catalogue: IrCatalogue): Set<string>` — строит symbols+state, обходит `state.all`, собирает `selectionId` узлов с `nodeHidden === true`.
  - `hiddenEntryIds` оставляем как есть (её синтетический цикл со skip специфичен для кандидатов; переиспользовать `nodeHidden` нельзя из-за interleaved-skip — комментарий поясняет почему).
- `evaluate.ts`: в существующем цикле `for (const node of state.all)`, после проверок constraints, если `nodeHidden(node, state)` → `raw.push({ severity: "warning", code: "selection.hidden", selectionId: node.selectionId, entryId: node.entry.id, message: \`${node.entry.name} is not available in the current army configuration\` })`. Точки/constraints не трогаем.

**Domain НЕ меняется:** `Issue` уже несёт `severity`/`code: z.string()`/`selectionId`/`entryId`.

### 2. web (`apps/web/src`)
- Проблема уже рендерится в общем списке issues (`App.tsx`) — детальная поверхность (сообщение называет сущность), покрывает и вложенные узлы.
- Навигационный маркер: `App` вычисляет `hiddenSelectionIds(roster, catalogue)` (useMemo) и передаёт в `RosterList`; юнит-строка получает предупреждающий маркер (точка + `title`), если **в её поддереве** есть скрытый выбранный узел. Хелпер `unitHasHiddenSelection(unit, hiddenSet)` рекурсивно проверяет `unit.id` и все вложенные `selections`.

## Тесты

**engine-eval (`test/visibility.test.ts`, `test/evaluate.test.ts`):**
- `hiddenSelectionIds`: ростер с выбранным узлом, чей `visibilityModifier set:true` срабатывает при текущем состоянии (напр. `notInstanceOf ancestor <cat>` и предок без cat) → его `selectionId` в наборе; узел, чей гейт НЕ срабатывает → не в наборе; статический `hidden` узел → в наборе.
- `nodeHidden`: реальный узел с context-scope гейтом (`ancestor`) резолвится по настоящей цепочке (без skip).
- `evaluate`: скрытый выбранный узел → issue `code:"selection.hidden"`, `severity:"warning"`, правильный `selectionId`/`entryId`; `valid` остаётся true (при отсутствии других error); `totalPoints` включает очки скрытого узла (не изменился).

**web (`components/RosterList.test.tsx`):**
- Юнит с скрытым выбранным потомком → маркер присутствует; без скрытых → маркера нет.
- `unitHasHiddenSelection` рекурсивно находит вложенный скрытый узел.

## Осязаемо

Добавляешь Enhancement, меняешь гейтящий выбор → узел помечается «недоступен» (issue в списке + маркер на юните), очки прежние, удаляешь вручную.

## Явно НЕ делаем
- Исключение скрытых узлов из очков/constraints (расходится с BattleScribe; отдельное решение при желании).
- Авто-удаление скрытых узлов (деструктивно).
- Per-row маркер внутри `UnitConfig` (юнит-уровневого маркера + списка issues достаточно; можно добавить позже).

## Риски
- **Двойной обход state** — `hiddenSelectionIds` строит свой state (для web), `evaluate` использует свой. Для типовых ростеров дёшево; не оптимизируем преждевременно.
- **Ложные срабатывания** при неполных данных — исключены строгим `passesGate` (тем же, что валидирует остальную видимость).
