# Дизайн + план: разрешение имён в сообщениях об ограничениях

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[roster-web-status]], [[engine-parser-status]]

## Проблема (UX-полиш)

Сообщения о нарушении force/entry-ограничений печатают сырые GUID:
`Not enough category "9cfd-1c32-585f-7d5c": 0 below min 1`,
`Not enough entry "8ea3-b125-7273-5ffb": 0 below min 1`. Нечитаемо для пользователя. (Групповые ограничения уже используют `group.name` — их не трогаем.)

## Решение

`checkConstraint` строит `target` из `constraint.targetId`. Добавляем опциональный резолвер имён `TargetNamer = (targetType, targetId) => string`:
- **category** → `catalogue.categoryNames[targetId]` (защищённый доступ `?.` — hand-built каталог без `categoryNames` деградирует к сырому id, не роняет `evaluate()`),
- **entry** → имя из `buildSymbolTable(catalogue).get(targetId)?.name`,
- оба с fallback на сырой id (категория/сущность из другого файла → не хуже прежнего).

`evaluate()` строит `targetNamer(catalogue)` один раз и прокидывает в оба вызова `checkConstraint`. Параметр **опционален** → прямые unit-тесты `checkConstraint` без резолвера видят сырой id (обратная совместимость).

## Слои (только `packages/engine-eval/src`)
- **`names.ts` (NEW):** `TargetNamer`, `targetNamer(catalogue)`.
- **`constraints.ts`:** `checkConstraint(..., nameOf?: TargetNamer)`; `target` использует разрешённое имя если резолвер передан.
- **`evaluate.ts`:** `const nameOf = targetNamer(catalogue)`; прокинуть в оба `checkConstraint`.
- **`index.ts`:** экспорт `./names`.

## Инвариант «не сломать существующее»
- Параметр опционален → сигнатура обратно совместима, старые тесты (сырой id) зелёные.
- Резолвер только форматирует сообщение — семантика нарушений/кодов/полей Issue не меняется.
- Защищённый доступ к `categoryNames` → `evaluate()` не падает на частичном каталоге (принцип «не крашиться»).
- Групповые сообщения (`group.name`) не тронуты.

## Тесты (engine-eval, 100%)
- `names.test.ts`: category-hit (имя), entry-hit (имя), category-miss/entry-miss → сырой id.
- `constraints.test.ts`: `checkConstraint` с резолвером → сообщение содержит имя, не GUID (category и entry); без резолвера → сырой id (существующие тесты).
- Полный прогон engine-eval 100%; turbo 4/4.

## Осязаемо
Реальный SM: `Not enough category "Character"`, `Not enough entry "Intercessor Sergeant"` вместо GUID. Проверено на реальном Intercessor Squad.
