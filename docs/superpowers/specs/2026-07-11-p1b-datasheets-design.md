# P1-b: Datasheets (профили / статлайны) — дизайн

**Дата:** 2026-07-11
**Фаза:** C дорожной карты War-Organ-parity (профили — самый крупный слой сходства).
**Цель:** провести профили BattleScribe (`<profiles>`) сквозь весь конвейер (Rust-парсер → IR → домен → `@muster/roster` → веб) и показать живой **datasheet** выбранного юнита: статлайн, таблицы оружия, abilities, keywords.

## Контекст: модель профилей BattleScribe

- `<profileType>` (в `.gst`) определяет тип профиля и **упорядоченный** список характеристик:
  - **Unit** — M / T / SV / W / LD / OC
  - **Ranged Weapons** — Range / A / BS / S / AP / D
  - **Melee Weapons** — Range / A / WS / S / AP / D
  - **Abilities** — Description
  - (Transport и пр. — прочие)
- У каждого `selectionEntry` (или группы) есть `<profiles>` → `<profile name typeId typeName>` → `<characteristics>` → `<characteristic name typeId>ТЕКСТ</characteristic>`.
  Значения — свободный текст: `6"`, `3+`, `5`, `Melee`; сущности XML экранированы (`6&quot;` → `6"`).
- **Оружие — это upgrade-`selectionEntry` со своим weapon-профилем.** Значит datasheet юнита =
  агрегация профилей по **всему выбранному поддереву** выбора. Выбрал Power Sword → в datasheet
  появилась строка его Melee-профиля. Это и есть «живой datasheet» War Organ.

**Ключевое упрощение:** каждый `<profile>` самодостаточен — несёт `typeName`, а каждая
`<characteristic>` несёт своё `name`. Поэтому `<profileTypes>` **не парсим**: порядок характеристик
в IR сохраняем как в исходном XML (он и есть порядок из profileType). Никакой FK-резолвинг по typeId
не нужен.

## Архитектура: 6 слоёв снизу вверх

### 1. Rust raw-слой (`packages/engine-parser/src/raw`)

Новые структуры в `model.rs`:

```rust
#[derive(Debug, Default, Clone)]
pub struct RawProfile {
    pub id: String,
    pub name: String,
    pub type_name: String,               // из атрибута typeName
    pub characteristics: Vec<RawCharacteristic>,
}
#[derive(Debug, Default, Clone)]
pub struct RawCharacteristic { pub name: String, pub value: String } // value = текст элемента
```

`RawEntry` и `RawGroup` получают поле `pub profiles: Vec<RawProfile>`.

В `parse.rs`: `read_profiles_into(dst, r)` читает `<profiles>` → `<profile>` (обычный и
self-closing) → `<characteristics>` → `<characteristic>` с текстовым содержимым (unescape).
Подключается веткой `b"profiles" =>` в `read_entry` и `read_group`. (Self-closing `<profiles/>`
и Empty-arm группы профилей не несут — поле остаётся пустым.)

Профили едут вместе с resolve entry-link'ов бесплатно: разрешение линка клонирует целевой
`RawEntry` (уже так работает для costs/constraints), новое поле копируется тем же `clone()`.

### 2. IR-слой (`packages/engine-parser/src/ir`)

`model.rs`:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrProfile {
    pub name: String,
    pub type_name: String,               // сериализуется как typeName
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub characteristics: Vec<IrCharacteristic>,
}
#[derive(Debug, Serialize)]
pub struct IrCharacteristic { pub name: String, pub value: String }
```

`IrEntry` получает `#[serde(skip_serializing_if = "Vec::is_empty")] pub profiles: Vec<IrProfile>`
(после `groups`). `map.rs::map_entry` строит `profiles` из `e.profiles`. `id` профиля в IR не
нужен (в UI не используется) — не эмитим.

**skip-if-empty** гарантирует: entry без профилей → golden байт-идентичен прежнему. Но фикстуру
мы дополним профилями (см. ниже) — так что golden **обновится осознанно** и покроет новый путь.

### 3. Домен (`packages/domain/src/ir.ts`)

```ts
export const IrCharacteristic = z.object({ name: z.string(), value: z.string() });
export const IrProfile = z.object({
  name: z.string(),
  typeName: z.string(),
  characteristics: z.array(IrCharacteristic).default([]),
});
```

`IrEntry` (и интерфейс, и lazy-схема) получает `profiles: z.array(IrProfile).default([])`.

### 4. Фикстура + веб-каталог

- `tests/fixtures/mini40k.cat` дополняется **синтетическими** профилями (GW-IP не тащим):
  Captain — Unit-статлайн (M6"/T4/SV3+/W5/LD6+/OC1) + ability; Power Sword / Power Axe — Melee-профили;
  Trooper — Unit-статлайн. Golden `mini40k.ir.json` регенерируется.
- `apps/web/src/mini40k.ir.json` (ручная копия для демо) синхронизируется с новым golden, чтобы
  веб-демо рисовало datasheet.

### 5. `@muster/roster` (`packages/roster/src/builder.ts`)

Чистая функция агрегации (логика в `builder.ts`, экспорт через barrel — покрытие 100%):

```ts
export interface DatasheetSection { typeName: string; profiles: IrProfile[] }
export function datasheet(catalogue: IrCatalogue, selection: RosterSelection): DatasheetSection[]
```

Обходит поддерево `selection` (сам + все вложенные `selections`), для каждого узла берёт
`catalogueEntry(catalogue, entryId).profiles`, группирует по `typeName` с сохранением порядка
первого появления. Дедупликация по идентичности (name + typeName) — один и тот же профиль от
двух моделей показываем один раз.

### 6. Веб (`apps/web/src/components/Datasheet.tsx`)

Компонент `Datasheet({ catalogue, selection })`, рисует секции из `datasheet(...)`:
- **Unit** → строка чипов-характеристик (M/T/Sv/W/Ld/OC).
- **Ranged/Melee Weapons** → таблица (колонки из `characteristics`, строка на профиль, первая
  ячейка — имя оружия).
- **Abilities** → имя + Description.
- **прочие typeName** → дженерик-таблица (тот же табличный рендер, что у оружия) — форвард-совместимо.
- **Keywords** → чипы из `entry.categories` (в mini-фикстуре id читаемы; резолв id→имя на реальном
  каталоге — отдельный фоллоу-ап, вне объёма).

Datasheet встраивается в `SelectionNode` каждого **корневого** юнита под его контролами — юнит
показывает свой живой datasheet, реагирующий на выбранный лут. (Полноценный master-detail —
отдельная Фаза A, не здесь.)

## Тестирование

- **Rust:** raw-тест (профиль с характеристиками, unescape `&quot;`→`"`); IR-тест (map эмитит
  профили, `typeName` camelCase); golden обновлён и зелёный.
- **Домен:** present/absent кейсы IrProfile.
- **roster:** 100% покрытие `datasheet` — пустой, статлайн, агрегация оружия из поддерева,
  дедуп, группировка/порядок.
- **web:** jsdom-тест — добавить юнит, увидеть статлайн; переключить оружие → строка появляется/уходит.

## Вне объёма (осознанно отложено)

- Резолв keyword id→имя на реальном каталоге (нужен эмит имён категорий в IR).
- Парсинг `<profileTypes>` и валидация набора характеристик против типа.
- Master-detail раскладка (Фаза A), enhancements/detachment (S2).
- Модификаторы профилей (набор/increment характеристик по условиям) — редки, отдельно.

## Инварианты

`#![forbid(unsafe_code)]` цел; golden регенерируется только осознанно; BSData-данные и
`.claude/settings.local.json` вне git; main не пушится без явного подтверждения.
