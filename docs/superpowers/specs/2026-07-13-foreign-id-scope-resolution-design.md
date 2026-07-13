# Foreign-id scope resolution (model-count pricing) — Design

**Дата:** 2026-07-13
**Статус:** утверждён к реализации (заземлён на реальном каталоге)

## Контекст и проблема

Реальные 40k-юниты меняют цену по числу моделей. Пример (Space Marines,
Intercessor Squad, entry `8da0-4570-c3c-819f`):

```xml
<cost name="pts" typeId="51b2-…" value="80"/>
<modifiers>
  <modifier type="set" value="160" field="51b2-…(pts)">
    <conditions>
      <condition type="atLeast" value="6" field="selections"
                 scope="8da0-4570-c3c-819f" childId="e371-…(Intercessor model)"
                 includeChildSelections="true"/>
```

Смысл: «pts = 160, если в **этом юните** (scope = его собственный entry-id) ≥6
моделей Intercessor». Т.е. 5 моделей → 80, 6–10 → 160.

**Баг:** `scope="8da0-…"` — это **foreign-id scope** (scope = id сущности, а не
ключевое слово). Парсер (`map_condition_scope`) такие GUID-scope **дропает**
(`condition.scope_unmapped`) → модификатор остаётся **без условий** → `set pts=160`
применяется **безусловно** → Intercessor стоит 160 даже при 1 модели.

На реальном SM таких брошенных foreign-scope условий ~90 (не только ценовых; см.
рекон детачмент-среза), но самый заметный эффект — неверная цена мультимодельных
юнитов, что для армибилдера критично.

### Что такое foreign-id scope

BattleScribe позволяет условию/констрейнту адресовать scope по **id сущности** вместо
ключевого слова. Семантика: «агрегировать в поддереве ближайшего предка-или-себя,
чей entry.id === scope». Для ценовых условий scope, как правило, = id **самого
владельца** модификатора (self-референс: «считать в этом юните»), но в общем случае
это любой предок. Движок уже так резолвит именованные context-scope (`unit`/`ancestor`
и т.д.) — не хватает ветки «scope = произвольный entry-id».

## Цели

1. Условия с foreign-id scope **мапятся** (не дропаются), и движок их **корректно
   вычисляет**, разрешая scope к ближайшему предку-или-себе с этим entry.id.
2. Цена по числу моделей верна на реальных данных: Intercessor 5 моделей = 80,
   6+ = 160 (и аналогично прочие breakpoint-юниты).

## Не-цели

- **Констрейнты с foreign-id scope** (`map_constraint`) — не трогаем в этом срезе;
  только условия (`map_condition`), где живут ценовые/видимостные гейты. Констрейнты
  продолжают дропать неизвестный scope, как сейчас.
- **`repeat`-модификаторы** (per-model инкремент цены, `<repeat>`) — отдельная
  механика, вне объёма; здесь только `set`/`increment`/`decrement` под условиями.
- Разрешение scope по id **категории** (не entry) — если встретится, падаем на
  безопасный дефолт (пустой набор → условие не срабатывает), не угадываем.

## Обзор архитектуры

Три пакета, порядок по зависимостям.

1. **`@muster/domain`** — `IrCondition.scope` расширить с фиксированного enum до
   строки (ключевые слова + произвольный entry-id). `AggregateSpec.scope` в engine
   синхронно расширить.
2. **`engine-parser` (Rust)** — `map_condition_scope`: неизвестный (не-keyword) scope
   эмитить как есть (raw entry-id), а не дропать. `map_constraint` НЕ меняется.
3. **`@muster/engine-eval`** — `scopeNodes`: дефолт-ветка для не-keyword scope =
   «ближайший предок-или-себя с `entry.id === scope`, вернуть его subtree (с учётом
   includeChildSelections)»; если такого нет — `[]` (условие агрегирует к 0, `set`
   не срабатывает — безопасно).

### domain — `IrCondition.scope`

`packages/domain/src/conditions.ts`: сейчас
`scope: z.enum(["self","parent","force","roster","root-entry","ancestor","unit","upgrade","model","model-or-unit"])`.
Заменить на `z.string()` (ключевые слова остаются валидными строками; entry-id тоже
строка). Документировать комментарием, что валидные значения = набор ключевых слов
**или** entry-id сущности-предка.

`AggregateSpec.scope` (engine `scopes.ts`) — расширить union до `string` (надмножество;
парсер решает, что эмитить). `IrConstraint.scope` (домен) НЕ трогаем — констрейнты
по-прежнему эмитят только keyword-scope.

### parser — `map_condition_scope`

`packages/engine-parser/src/ir/map.rs`, `map_condition_scope`. Сейчас `match` по
keyword-scope, дефолт → `condition.scope_unmapped` + `None`. Изменение: дефолт-ветка
(scope не совпал с keyword) возвращает `Some(scope.to_string())` — сырой entry-id
проходит в IR. Диагностик `condition.scope_unmapped` для условий исчезает.

`primary-catalogue` → `roster` (алиас) остаётся. `map_constraint` и его inline
scope-проверка не меняются (констрейнты вне объёма).

**Golden-тест байт-идентичен** — обновить эталон под новый вывод, если мини-фикстура
содержит foreign-scope условия (вероятно нет → эталон не меняется; проверить).

### engine — `scopeNodes` дефолт-ветка

`packages/engine-eval/src/scopes.ts`, `scopeNodes`. Добавить обработку не-keyword
scope: ближайший узел вверх по цепочке (включая сам `node`), чей `entry.id === spec.scope`,
затем `subtree(anchor, spec.includeChildSelections)`; если не найден — `[]`.

```ts
// default (не одно из ключевых слов): foreign-id scope = id сущности-предка.
// Резолвим к ближайшему предку-или-себе с этим entry.id и берём его поддерево.
default: {
  if (!node) return [];
  const anchor = nearestByEntryId(node, spec.scope);
  return anchor ? subtree(anchor, spec.includeChildSelections) : [];
}
```

где `nearestByEntryId(node, id)` идёт `for (let n = node; n; n = n.parent)` и возвращает
первый с `n.entry.id === id`. Для self-референсного ценового условия (scope = id
владельца) это сам узел юнита → subtree считает его модели.

`scopeUnanchored` (для type-scope) не трогаем — foreign-id scope не «unanchored»
в смысле type-scope (его пустой результат легитимен: предок не найден → 0).

Поскольку `scope` в `AggregateSpec` станет `string`, `switch (spec.scope)` перестанет
быть исчерпывающим по литералам — добавить `default`, покрывающий и `primary-catalogue`
(его парсер уже алиасит в `roster`, но на всякий случай дефолт даёт безопасное 0).

## Поток данных (Intercessor 6 моделей → 160)

1. Парсер эмитит условие `atLeast 6 selections scope="8da0" child=e371` (раньше дропал).
2. `resolveCosts`/`effectiveNodePoints` применяет cost-модификатор `set 160` под этим
   условием к узлу Intercessor.
3. `passesGate` → `aggregate(selections, scope="8da0", target=e371)`; `scopeNodes`
   резолвит `8da0` к самому узлу Intercessor (его entry.id), subtree считает модели e371.
4. 6 моделей → `6 >= 6` → true → `set 160` применяется → 160. 5 моделей → false → 80.

## Обработка ошибок / краевые случаи

- **scope-id не найден среди предков:** `scopeNodes` → `[]` → aggregate 0 → `atLeast N`
  ложно → `set` не срабатывает → базовая цена. Безопасно (никогда не завышаем цену
  по нерезолвимому scope).
- **node === null** (force-level проверка условия): `[]`, как у прочих node-relative
  scope.
- **scope = id категории (не entry):** `nearestByEntryId` не найдёт (сравнивает entry.id)
  → `[]` → условие ложно. Не угадываем; безопасный дефолт (см. Не-цели).
- **Обратная совместимость:** keyword-scope (self/roster/…) идут прежними ветками
  `switch`; поведение не меняется. Существующие тесты остаются зелёными.

## Стратегия тестирования

- **domain:** unit — `IrCondition.parse` принимает `scope: "<entry-id>"` (произвольная
  строка); round-trip.
- **parser (Rust):** unit — условие с `scope="<guid>"` больше не дропается (эмитится
  как есть, без `condition.scope_unmapped`); keyword-scope не регрессируют. Обновить
  golden при необходимости (проверить байт-идентичность).
- **engine-eval:** unit — `scopeNodes`/`aggregate` для foreign-id scope: (a) self-реф
  (scope = id владельца) считает модели в поддереве; (b) scope = id предка выше по
  дереву; (c) нерезолвимый scope → 0. Сквозной тест ценообразования: юнит base 80 +
  cost-модификатор `set 160` под `atLeast 6 selections scope=<self-id> child=<model>`;
  5 моделей → 80, 6 → 160. Покрытие 100%.
- **сквозная проверка на реальном SM:** Intercessor Squad 5 моделей = 80, 10 = 160
  (и ≥1 другой breakpoint-юнит); проверка через throwaway-спеку на реальном IR +
  в браузере (изменить счётчик моделей → цена прыгает на breakpoint). Скриншот.

## Влияние

Восстанавливает ~90 ранее брошенных foreign-scope условий (видимость/цена/валидация-гейты
на условиях). Основной ощутимый эффект — верная цена мультимодельных юнитов. Констрейнты
с foreign-scope остаются вне объёма (отдельный возможный срез).
