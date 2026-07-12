# Дизайн: entryLink-hosted hidden

**Дата:** 2026-07-12
**Статус:** утверждён к реализации
**Связано:** [[engine-parser-status]], `2026-07-11-conditional-visibility-design.md` (A+B), `2026-07-11-context-aware-visibility-design.md` (C-a), `2026-07-12-entry-type-and-type-scopes-design.md`

## Проблема

BattleScribe `<entryLink>` (инлайнит общую `selectionEntry`/`selectionEntryGroup`) может нести **собственный** `hidden`-атрибут и **собственные** `<modifiers>` (в т.ч. `field="hidden"` с условиями), применяемые к конкретной вставке — а не к целевой сущности. Текущий `RawEntryLink` несёт только `target_id`+`link_type`, поэтому `hidden` и модификаторы на ссылке **молча теряются** (хуже `_unmapped`: без диагностики). Это последний невзятый тип детачмент-гейтинга — общие Enhancement-сущности, гейтящиеся на месте вставки.

**Реальный SM:** из 2306 entryLinks — статический `hidden="true"` **0**, с любыми модификаторами **53**, с `field="hidden"` модификатором **17** (16 на `selectionEntry`, 1 на группу). Все условия этих 17 используют компараторы (instanceOf/notInstanceOf/atLeast/equalTo) и scopes (primary-catalogue/ancestor/model-or-unit/parent), **уже поддержанные** downstream. Значит недостающее звено — ровно захват+применение на raw/resolve; маппинг, engine-eval и web уже работают.

## Скоуп

**Делаем:** захват `hidden`-атрибута и `<modifiers>` на `<entryLink>`; применение **hidden**-семантики к инлайненному инстансу (entry-links). Не-hidden и group-level visibility — громкий дроп с диагностикой.

**НЕ делаем (отдельные срезы):** cost/constraint модификаторы на ссылках (pricing-срез); group-level link visibility; `includeChildSelections`-семантика container-scopes (уже в фоне).

## Инвариант «никогда не пере-скрывать»

Держится downstream без изменений: hidden-модификаторы ссылки проходят существующий **строгий** `map_visibility_modifier` (мапится только если ВСЕ условия поддержаны, иначе весь модификатор дропается → сущность видима), а C-a no-owner-skip покрывает context-scopes. Статический `hidden` комбинируется как `resolved.hidden || link.hidden` (только добавляет скрытие; на реальных данных инертен — 0 вхождений).

## Слои (только parser; domain/engine-eval/web НЕ трогаем)

### 1. `raw/model.rs`
`RawEntryLink` += `pub hidden: bool`, `pub modifiers: Vec<RawModifier>` (к существующим `target_id`, `link_type`).

### 2. `raw/parse.rs` — `read_entrylinks_into`
Единая воронка для entryLinks всех уровней (catalogue/entry/group). Сейчас `Event::Start` и `Event::Empty` обрабатываются одинаково и тело ссылки не читается (`<modifiers>` попадает в `skip_element`). Меняем:
- **`Event::Empty` entryLink** → push `RawEntryLink { target_id, link_type, hidden: attr_bool(&e,"hidden"), modifiers: vec![] }`.
- **`Event::Start` entryLink** → построить `RawEntryLink` с `hidden`, затем прочитать тело до `</entryLink>`: `<modifiers>` → `read_modifiers_into(&mut link.modifiers, r)`; прочий `Start` → `skip_element`; `End entryLink` → push и продолжить внешний цикл.

Переиспользуются существующие `attr_bool` и `read_modifiers_into`.

### 3. `resolve/links.rs` — `resolve_link`
После клонирования target в `resolved`:
- **entry-link** (`else`-ветка): вызвать `apply_link_visibility(link, &mut resolved, diags)` перед `children.push(resolved)`.
- **group-link** (`selectionEntryGroup`): если ссылка несёт `hidden`-атрибут ИЛИ `field="hidden"` модификатор → диагностика `entryLink.group_hidden_unsupported`; не-hidden модификаторы → `entryLink.modifier_dropped`. Резолвинг группы без изменений.

Новый хелпер:
```rust
fn apply_link_visibility(link: &RawEntryLink, resolved: &mut RawEntry, diags: &mut Vec<Diagnostic>) {
    if link.hidden { resolved.hidden = true; }
    for m in &link.modifiers {
        if m.field == "hidden" {
            resolved.modifiers.push(m.clone());   // per-instance: resolved уже уникальный клон
        } else {
            diags.push(Diagnostic {
                code: "entryLink.modifier_dropped".to_string(),
                message: format!("entryLink to {} has a non-hidden modifier (field {}); dropped", link.target_id, m.field),
            });
        }
    }
}
```
Дописанные hidden-модификаторы проходят существующий путь `map_entry` (`if m.field == "hidden"` → `map_visibility_modifier` → `IrEntry.visibilityModifiers`). Клон `resolved` уникален на каждую вставку → без утечки между placements.

## Тесты

**raw (`tests/raw_parse.rs`):**
- entryLink с `hidden="true"` и вложенным `field="hidden"` модификатором → `RawEntryLink.hidden == true` и `modifiers.len() == 1`.
- `Event::Empty` entryLink (самозакрытый) → `hidden` из атрибута, `modifiers` пуст.

**resolve/map (`tests/map.rs` или `tests/resolve.rs`, через `to_ir(&resolve(parse_raw(xml)))`):**
- Родительская сущность с entryLink на target-`selectionEntry`, ссылка несёт `field="hidden"` модификатор с поддержанным условием (напр. `notInstanceOf scope="ancestor"`) → инлайненный инстанс имеет `visibility_modifiers.len() == 1`; целевая сущность (если тоже инлайнена в другом месте без ссылки-модификатора) — без него.
- Ссылка с `hidden="true"` на не-hidden target → `resolved.hidden == true`.
- Ссылка с не-hidden модификатором (напр. `field="pts"`) → диагностика `entryLink.modifier_dropped`, модификатор НЕ в `resolved`.
- group-link с `field="hidden"` модификатором → диагностика `entryLink.group_hidden_unsupported`.

**Golden mini40k** — байт-идентичен (в фикстуре нет hidden/модификаторов на ссылках).

**Осязаемо:** реальный SM — 16 ранее невидимых hidden-гейтов на Enhancement-ссылках эмитятся в `visibilityModifiers`; `entryLink.modifier_dropped` показывает ~36 отложенных cost-on-link; `entryLink.group_hidden_unsupported` = 1.

## Риски
- **Дубли модификаторов при повторном резолвинге** — исключены: `resolved` — уникальный клон per-placement; модификаторы дописываются в него, не в общий target.
- **Пере-скрытие** — исключено строгим downstream-маппингом + no-owner-skip.
- **Golden-дрейф** — не ожидается (фикстура без таких ссылок); если появится, значит парсер стал читать больше — проверить диффом.
