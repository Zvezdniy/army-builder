# Дизайн: per-placement адресация (keystone) — резолвинг выбора по дереву

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[engine-parser-status]], [[real-catalogue-web-probe]], `2026-07-12-entrylink-hosted-modifiers-design.md`

## Проблема (keystone-блокер оценки реальных каталогов)

`buildState(roster, symbols)` резолвит каждый `selection.entryId` через **плоский** `buildSymbolTable` (id→IrEntry). `buildSymbolTable` **бросает «Duplicate entry id»** на одноимённых сущностях, которые не байт-идентичны (толерантен только к идентичным клонам — namespace-инвариант). Парсер инлайнит общие сущности как клоны с одним id; последние срезы (entryLink hidden/modifiers, per-placement) сделали эти клоны РАЗЛИЧНЫМИ (per-placement модификаторы/видимость) → `evaluate()` бросает, роняя весь ростер. **Эмпирически:** реальный SM IR бросает в `buildSymbolTable` (`caa-…`/`fd43-…`) → **реальные каталоги нельзя оценить**. Плюс даже без throw плоский резолвинг по голому id теряет per-placement (first-wins), обесценивая весь per-placement труд.

## Решение

Резолвить выбор ростера **по дереву каталога (родительский контекст)**, а не по плоскому id. Тогда каждая вставка использует СВОЙ инлайненный экземпляр (со своими per-placement модификаторами), и одноимённые расходящиеся клоны перестают быть проблемой — они различимы по позиции в дереве.

Две части:
1. **`buildSymbolTable` → толерантный** (first-wins на расхождении, БЕЗ throw). Per-placement расхождение одноимённых клонов теперь легитимно (не malformed), поэтому throw-guard устарел и его снимаем. Индекс остаётся: (а) fallback в `buildState`, (б) итерация всех уникальных сущностей в `hiddenEntryIds` (`symbols.values()`).
2. **`buildState(roster, catalogue)` — tree-based резолвинг:** для дочернего выбора кандидаты = `parentEntry.children` (группо-члены уплощены туда парсером); для корневого = `catalogue.entries`. Совпадение по id → это per-placement экземпляр под этим родителем. Не найдено под родителем (malformed/кросс-версия ростер) → толерантный flat-fallback (не хуже прежнего). Неизвестный id → throw «Unknown entryId» (как сейчас).

## Слои (только `packages/engine-eval/src`)

### `symbols.ts` — толерантный индекс
`buildSymbolTable`: на коллизии id — **first-wins без throw** (убрать `JSON.stringify`-сравнение и `throw`; либо: идентичный клон — skip, расходящийся — тоже skip/first-wins, без падения). Обновить doc-комментарий (per-placement расхождение легитимно; индекс — плоский first-wins для fallback/итерации). Сигнатура/экспорт без изменений.

### `state.ts` — tree-based `buildState`
```ts
export function buildState(roster: Roster, catalogue: IrCatalogue): EvalState {
  const flat = buildSymbolTable(catalogue);           // tolerant fallback + unknown-detection
  const all: EvalNode[] = [];
  const resolve = (parentEntry: IrEntry | null, entryId: string): IrEntry => {
    const siblings = parentEntry ? parentEntry.children : catalogue.entries;
    const local = siblings.find((e) => e.id === entryId);
    if (local) return local;                          // per-placement instance under this parent
    const fallback = flat.get(entryId);               // malformed/cross-context roster
    if (fallback) return fallback;
    throw new Error(`Unknown entryId in roster: ${entryId}`);
  };
  const build = (selection, parent, parentMultiplier, depth) => {
    assertDepth(depth, "Roster selection");
    const entry = resolve(parent ? parent.entry : null, selection.entryId);
    const node: EvalNode = { selectionId: selection.id, entry, count: selection.count,
      multiplier: parentMultiplier, effectiveCount: selection.count * parentMultiplier,
      categories: entry.categories, parent, children: [] };
    all.push(node);
    node.children = selection.selections.map((c) => build(c, node, node.effectiveCount, depth + 1));
    return node;
  };
  const roots = roster.selections.map((s) => build(s, null, 1, 1));
  return { roots, all };
}
```
Импорт `IrCatalogue`; `SymbolTable`-импорт не нужен (buildSymbolTable вызывается внутри).

### Вызыватели → `buildState(roster, catalogue)`
- `evaluate.ts`: убрать `const symbols = buildSymbolTable(catalogue)`; `buildState(roster, catalogue)`.
- `visibility.ts` `hiddenEntryIds`: оставить `const symbols = buildSymbolTable(catalogue)` (нужен для `symbols.values()`); `buildState(roster, catalogue)`.
- `visibility.ts` `hiddenSelectionIds`: `buildState(roster, catalogue)`; убрать неиспользуемый `buildSymbolTable`.
- `limits.ts`: обновить комментарий, ссылающийся на «buildSymbolTable's duplicate-id throw» (throw убран).

### Тест-churn (механически)
35 сайтов `buildState(X, buildSymbolTable(Y))` в 12 тест-файлах → `buildState(X, Y)` (regex `buildState\(([^,]+), buildSymbolTable\(([^)]+)\)\)` → `buildState($1, $2)`); удалить ставшие неиспользуемыми импорты `buildSymbolTable` (кроме `symbols.test.ts`, который тестирует его напрямую).

## Инвариант «никогда не мискомпилировать / не сломать существующее»
- Существующие каталоги (без расхождений): tree находит дочку под родителем = тот же экземпляр, что давал flat → **поведение неизменно** (все тесты зелёные).
- Существующие тесты, где дочерний выбор ссылается на top-level сущность (не под родителем): tree не находит → flat-fallback находит → резолвится (не хуже прежнего).
- Расходящиеся одноимённые клоны: tree берёт правильный per-placement экземпляр; `buildSymbolTable` больше не бросает → `evaluate()` НЕ падает.
- Неизвестный id → по-прежнему throw «Unknown entryId».
- Утрата throw-guard на genuinely-malformed дублях: осознанно (per-placement расхождение теперь легитимно; для untrusted BSData «работать first-wins» робастнее «уронить весь ростер»; парсер уже валидирует на parse-time).
- Domain/parser/web НЕ трогаем (evaluate/hiddenEntryIds/hiddenSelectionIds сохраняют публичные сигнатуры).

## Тесты
**engine-eval `symbols.test.ts`:** расходящиеся одноимённые сущности → `buildSymbolTable` НЕ бросает, first-wins (перевернуть существующий throw-тест); идентичные клоны → skip (как было).
**engine-eval `state.test.ts`:** дочерний выбор с per-placement расхождением (общий id под двумя родителями, разные модификаторы/стоимость) → узел под родителем A несёт экземпляр A, под B — экземпляр B; корневой резолвится из `catalogue.entries`; неизвестный id → throw; ссылка не-под-родителем → flat-fallback.
**engine-eval `parser-contract.test.ts`:** каталог с ОБЩИМ id, инлайненным в две единицы, одна вставка со `costs[].modifiers`-скидкой (ранее это БРОСАЛО в buildSymbolTable) → `evaluate()` теперь успешен и оценивает per-placement верно (A=3, B=5). Это разблокирует ранее недостижимый same-id per-placement кейс из предыдущего среза.
**Полный прогон:** engine-eval 100% (35 обновлённых сайтов зелёные), turbo 4/4.

## Осязаемо
Реальные каталоги (SM) больше не роняют `evaluate()` в `buildSymbolTable` → **разблокирована оценка реальных каталогов** (веб-билдер на реальном SM, а не только mini). Весь per-placement труд (модификаторы на стоимости/лимитах/видимости/категориях конкретной вставки) теперь доходит до движка на реальных данных. Пост-мёрж: smoke-проверка — распарсить реальный SM, построить простой ростер, `evaluate()` без throw.
