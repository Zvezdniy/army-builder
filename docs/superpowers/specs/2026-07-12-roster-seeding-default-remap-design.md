# Дизайн: roster-seeding fix — ремап group default (link-id → target-id) + защитный сидинг

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[roster-web-status]], [[engine-parser-status]], `2026-07-12-per-placement-addressing-keystone-design.md`, `2026-11-nr-config-defaults` (сидинг дефолтов)

## Проблема (ближайший блокер к добавлению реальных боевых юнитов)

`addUnit`+`evaluate` бросает `Unknown entryId in roster: <guid>` на большинстве реальных боевых юнитов (напр. Intercessor Squad). `buildState` резолвит дочерний selection по `parentEntry.children`, не находит преднаполненный `addUnit`-ом entryId → throw → белый экран билдера.

**Корень (эмпирически на реальном SM):** у `<selectionEntryGroup>` атрибут `defaultSelectionEntryId` указывает на **id `<entryLink>`** (напр. `fd17-cf82-6413-f1d7`), а НЕ на id целевой сущности. Резолвер инлайнит link-члена под **target-id** (`<entryLink id="fd17" targetId="6155">` → член 6155), и `member_entry_ids`/`children` несут target-id 6155. Но парсер эмитит `defaultMemberEntryId` = сырой link-id fd17 (без ремапа). Рассинхрон: дефолт не совпадает ни с одним членом/ребёнком. **Масштаб: 186 из 228 групп с дефолтом на реальном SM** имеют default ∉ members — то есть баг делает билдер непригодным для большинства юнитов, это не единичный случай.

Дополнительно: `RawEntryLink` вообще НЕ хранит свой `id` (только `target_id`), поэтому ремап невозможен без правки raw-модели.

## Решение (два слоя)

### 1. Парсер (устранение корня)

- **`RawEntryLink` получает поле `id: String`**; парс-путь entryLink читает атрибут `id` (оба места в `raw/parse.rs`).
- **`resolve_group` ремапит дефолт:** после резолюции, пока `group.entry_links` ещё доступны (до `out.entry_links = Vec::new()`), если `out.default_selection_entry_id` совпадает с `id` одного из `group.entry_links`, заменить его на `link.target_id` этого линка — то есть на id, под которым член реально материализован. Прямой (не link) member-дефолт остаётся как есть (совпадает с `entry.id` члена). Отсутствующий линк-таргет (dangler) — дефолт остаётся сырым, но добивается защитой (слой 2).

Downstream (`map_group`) не трогаем — он читает уже-ремапнутый `default_selection_entry_id`.

### 2. Roster (защита — билдер никогда не сеет нерезолвимое)

`initialChildren` (`packages/roster/src/builder.ts`) сейчас сеет `pick = g.defaultMemberEntryId ?? (min>=1 ? memberEntryIds[0] : undefined)` без проверки, что `pick` — реальный материализованный ребёнок. Исправление: сеять только id, присутствующий в `entry.children`. Правило `groupSeed(g)`:
- кандидат = `defaultMemberEntryId`, ЕСЛИ он есть среди `entry.children` по id; иначе
- при `min ≥ 1` — первый `memberEntryIds`, присутствующий в `children`; иначе
- ничего (опциональная группа без валидного дефолта).

Так любой остаточный рассинхрон (dangler, кросс-файл) даёт валидный сид или пропуск — но НИКОГДА нерезолвимый entryId в ростере.

**Не трогаем:** `buildState`-throw на genuinely-unknown roster id (это корректный сигнал для malformed внешнего ростера; наш сидинг после фикса такого не производит). Семантику keystone-резолвинга не меняем.

## Инвариант «никогда не мискомпилировать / не сломать существующее»

- Прямой (не link) дефолт: `id` члена == его `entry.id` → ремап no-op → без изменений. Golden mini-фикстура (Assault Squad default=chainsword как прямой член) байт-идентична — проверить прогоном golden.
- `RawEntryLink.id` — внутреннее поле, не сериализуется; на IR-выход влияет ТОЛЬКО ремап дефолта.
- Roster-guard строго сужает выбор до существующих детей: корректные дефолты (после парсер-фикса) используются как есть; невалидные — заменяются валидным членом или пропускаются (было — краш).
- Keystone: члены и дефолт теперь оба в target-id пространстве → tree-резолвинг находит преднаполненный selection под родителем.

## Тесты

**parser (`tests/resolve.rs` / `tests/map.rs`):**
- Группа с `defaultSelectionEntryId` = id линка, линк `targetId` = X → после резолюции `default_selection_entry_id` == X (ремап). IR: `defaultMemberEntryId` совпадает с одним из `memberEntryIds`.
- Группа с прямым member-дефолтом (id == entry.id) → дефолт без изменений (no-op).
- Dangler: дефолт = id линка, target отсутствует → дефолт остаётся сырым (диаг о dropped линке уже есть), не паникуем.
- Golden байт-идентичен.

**roster (`builder.test.ts`):**
- Группа, чей `defaultMemberEntryId` НЕ среди children → `addUnit` сеет первого валидного члена (min≥1) вместо нерезолвимого id; `evaluate` не бросает.
- Группа с валидным дефолтом → сеет именно его (регресс дефолт-сидинга не сломан).
- Опциональная группа (min 0) с невалидным дефолтом → ничего не сеется.

**cross-language / веб-контракт:** реальный Intercessor Squad — распарсить фикстуру (или синтетический аналог: юнит с группой-линком и link-id дефолтом) → `addUnit`+`evaluate` успешен (не throw), member-дефолт корректен.

## Осязаемо (пост-мёрж)

Веб-билдер на реальном SM: добавить Intercessor Squad (и прочие боевые юниты) → рендерится датащит, `evaluate()` НЕ падает, преднаполненное оружие = корректный дефолт (Bolt Rifle), 0 ошибок консоли. Снимает ближайший блокер к практическому построению реальных ростеров.
