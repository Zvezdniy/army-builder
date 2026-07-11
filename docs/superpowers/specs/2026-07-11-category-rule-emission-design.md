# Дизайн: эмиссия `categoryNames` и `ruleTexts` парсером (дешёвые видимые победы)

**Дата:** 2026-07-11
**Статус:** утверждён к реализации
**Связано:** [[real-catalogue-web-probe]], [[engine-parser-status]], `2026-07-11-engine-eval-dupe-id-tolerance-design.md`

## Проблема

Домен-схема и веб **уже** потребляют два каталог-уровневых словаря, но парсер их **не эмитит** (пробинг реального SM: 0 / 0):

- `IrCatalogue.categoryNames: Record<catId, name>` — веб (`AddUnitPicker`, `RosterList`, `UnitDetail`, `roster.unitsByRole`) показывает роли и ключевики юнита именами; без словаря видны GUID-ы.
- `IrCatalogue.ruleTexts?: Record<ruleName, text>` — `Datasheet.tsx` берёт `catalogue.ruleTexts?.[keyword]` для тултипа правила у чипа оружия; без словаря — «No rule description.».

Данные для обоих в исходных XML есть. `RawCatalogue.categories` (id→name) уже читается и мёржится (`merge_supporting` юнионит, primary wins), но не проливается в IR. Правила (`<rule name><description>`) не читаются совсем.

## Границы (что делаем / чего НЕ делаем)

**Делаем — только `engine-parser` (Rust):**
- Читаем определения правил (`<rule>`+`<description>`, опц. `<alias>`) из .cat и .gst.
- Эмитим `categoryNames` (из уже читаемых `categories`) и `ruleTexts` в `IrCatalogue`.

**НЕ делаем (отдельные срезы):**
- Домен-схема/веб не трогаются (уже готовы принять оба поля).
- Извлечение/линковка ключевиков оружия из профилей (какой чип какой keyword показывает — P1b-территория; здесь только каталог-словарь, по которому веб ищет).
- Структурное ужатие IR, conditions/modifiers-диагностики, sibling-библиотеки — вне среза.

## Поведение

### `categoryNames`
- `RawCatalogue.categories: HashMap<id, name>` уже наполняется (`<categoryEntry>` из .cat и .gst) и юнионится при мультифайловой сборке.
- `to_ir` кладёт его в новое поле `IrCatalogue.category_names` как **`BTreeMap<String,String>`** (детерминированный порядок → golden байт-стабилен). serde `rename_all=camelCase` → `categoryNames`; `skip_serializing_if = BTreeMap::is_empty`.

### `ruleTexts`
- Правила в .cat в основном **вложены** в `selectionEntries`/`forceEntries` (39 контейнеров `<rules>` на 40 правил); в .gst — top-level `<sharedRules>`. Чтобы собрать все определения независимо от вложенности, читаем их **отдельным плоским проходом** по тем же байтам: `read_all_rules(bytes) -> BTreeMap<String,String>`.
  - Второй `SafeXmlReader` по документу; на каждом `<rule>`-Start с атрибутом `name` читаем текст его `<description>` (переиспользуем `read_text_until(r, b"description")`), пропуская прочие дети до `</rule>`. Пустые/`Empty` `<rule/>` без описания — пропускаем.
  - Если у правила есть непустой `<alias>` — добавляем **вторым ключом** `alias → тот же текст` (реальные ключевики оружия часто идут алиасом в верхнем регистре, напр. `PISTOL`), чтобы тултипы резолвились и по имени, и по алиасу.
  - Ключ-словарь — `BTreeMap` (детерминизм). Клэш ключей — last-wins (разные правила с одинаковым именем крайне маловероятны).
- Наполняется в `RawCatalogue.rules` внутри `parse_raw` (в конце, вторым проходом). `merge_supporting` юнионит `rules` из supporting в primary тем же правилом «primary wins» (`entry(k).or_insert(v)`), что и `categories`/`cost_types` — чтобы правила .gst попали в итог.
- `to_ir` кладёт в `IrCatalogue.rule_texts: BTreeMap<String,String>`, serde `ruleTexts`, `skip_serializing_if = BTreeMap::is_empty`.

### Совместимость с доменом
`categoryNames` пуст → поле опущено → Zod `default({})`. `ruleTexts` пуст → опущено → Zod `optional` = undefined. Непустые → обычные объекты string→string. Изменений в `@muster/domain` не требуется.

## Тесты

**Rust (`engine-parser`):**
1. `read_all_rules`: байты с `<rule name="Pistol"><description>text</description><alias>PISTOL</alias></rule>`, вложенным внутрь `<selectionEntry>` → карта содержит и `Pistol`, и `PISTOL` → один и тот же текст.
2. `read_all_rules`: `<rule>` без `<description>` (или `Empty`) → не попадает / без паники; сущности в описании (`&quot;` и т.п.) разворачиваются (через существующий `read_text_until`).
3. `to_ir`: `RawCatalogue` с `categories` и `rules` → `IrCatalogue.category_names`/`rule_texts` заполнены; пустые → сериализация опускает поля.
4. **Golden** `mini40k.ir.json`: перегенерировать — теперь появляется `categoryNames` (у фикстуры 3 `<categoryEntry>`); `ruleTexts` отсутствует (в фикстуре нет `<rule>`), поле опущено. `.catz`-путь (`parses_the_zip_form_identically`) остаётся эквивалентным (фикстуру НЕ меняем — только golden JSON).

**Осязаемая проверка (руками, не в CI):**
- CLI на реальных .cat+.gst → в IR присутствуют `categoryNames` (сотни) и `ruleTexts` (десятки, вкл. `Pistol`/`PISTOL`).
- Веб: реальные роли отображаются именами (не GUID), тултип у чипа ключевика показывает текст правила.

Реальный GW-IP IR в git не коммитим.

## Риски
- **Дубли имён правил** между .cat и .gst → last-wins; приемлемо, тексты по одному ключевику совпадают семантически.
- **Второй проход по байтам** — разовая дешёвая стоимость (плоский стрим); парс реального набора уже ~1.7 c, добавка мала.
- **Golden-дрейф** — ожидаем и учтён (перегенерация только JSON, фикстура .cat/.catz без изменений).
