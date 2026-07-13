# Панель легальности армии — дизайн

**Дата:** 2026-07-13
**Срез:** matched-play легальность в UI (points-метр + вердикт + чеклист армейских правил + сгруппированные issues)

## Проблема

Движок `evaluate()` уже вычисляет всё, что нужно турнирному игроку для ответа «легальна ли моя армия»:
`ValidationResult { valid, totalPoints, pointsLimit, issues, dismissed, hasHouseRules }`.
Force-constraints (армейские лимиты композиции — «нужен ≥1 Battleline» и т.п.) энфорсятся в
`evaluate.ts` и, при нарушении, попадают в `issues`. Но в вебе это выведено плоско:

- очки — голый `<span>{total} / {limit} pts</span>` в шапке;
- issues — простой `<ul>` со строками `severity: message`, без группировки и без фокуса на юнит.

Матч-плей игрок не видит **позитивного** подтверждения («✓ Battleline: 3 из ≥1»), не видит
остатка очков/перебора визуально, не может кликом перейти к юниту-нарушителю, и нет единого
вердикта LEGAL / ILLEGAL. Это делает продукт неполноценным именно в его целевом формате.

## Ключевое ограничение движка

`checkConstraint` возвращает `Issue` **только при нарушении**. Проходящие правила не порождают
ничего. Чтобы показать зелёный чеклист (а не только красные нарушения), движку нужна позитивная
enumeration армейских правил — их actual/limit/satisfied независимо от факта нарушения.

## Решение

Две части: тонкое additive-расширение контракта движка (позитивные проверки) и UI-панель.

### Часть A — движок: армейские проверки (`checks`)

Новая сущность в `@muster/domain` (`validation.ts`):

```ts
export const LegalityCheck = z.object({
  id: z.string(),            // id constraint'а, либо "points"
  kind: z.enum(["points", "force"]),
  label: z.string(),         // человекочитаемо: "Points" | 'At least 1 "Battleline"'
  actual: z.number(),
  limit: z.number(),
  satisfied: z.boolean(),
  constraintType: z.enum(["min", "max"]).optional(), // только для kind="force"
});
export type LegalityCheck = z.infer<typeof LegalityCheck>;
```

Расширить `ValidationResult`:

```ts
checks: z.array(LegalityCheck).default([]),
```

`.default([])` делает поле необязательным на входе — все существующие литералы
`ValidationResult`/`evaluate()`-моки в тестах остаются валидными без правок.

**`constraints.ts` — `describeConstraint`.** Sibling к `checkConstraint`, переиспользует
`aggregate` + `effectiveConstraintValue`, но возвращает состояние всегда (не только при
нарушении). `null` — когда правило не применимо на данном якоре (та же skip-логика, что в
`checkConstraint`: force-level узел с node-relative scope, либо `scopeUnanchored`), чтобы в
чеклист не попадали правила, не действующие на уровне армии.

```ts
export function describeConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): { actual: number; limit: number; satisfied: boolean } | null {
  if (node === null && constraint.scope !== "force" && constraint.scope !== "roster") return null;
  if (scopeUnanchored(node, constraint, state)) return null;
  const actual = aggregate(node, constraint, state, costOf);
  const limit = effectiveConstraintValue(constraint, node, state, costOf);
  const satisfied = constraint.type === "max" ? actual <= limit : actual >= limit;
  return { actual, limit, satisfied };
}
```

**`evaluate.ts` — сборка `checks`.** После вычисления `totalPoints` и до/после issues собрать:

1. Points-проверка всегда первой:
   `{ id: "points", kind: "points", label: "Points", actual: totalPoints, limit: pointsLimit, satisfied: totalPoints <= pointsLimit }`.
2. По каждому `catalogue.forceConstraints`: вызвать `describeConstraint(c, null, state, costOf)`;
   если не `null` — добавить `force`-проверку. Label строится через существующий `nameOf`:
   `min` → `At least {limit} {targetType} "{name}"`, `max` → `At most {limit} …`.

`issues`, `valid`, `dismissed`, `hasHouseRules`, `totalPoints`, `pointsLimit` **не меняются**.
`checks` — чисто аддитивная информация. `valid` по-прежнему выводится из `issues` (ошибки).

Инвариант согласованности (проверяется тестом): для каждого force-`check`, `satisfied === false`
тогда и только тогда, когда в `issues` есть соответствующий `constraint.min|max` с тем же
`constraintId`. Points-`check.satisfied === false` ⇔ есть issue `points.over`.

### Часть B — веб: `LegalityPanel`

Новый компонент `apps/web/src/components/LegalityPanel.tsx`. Заменяет и голый points-span, и
плоский issues-`<ul>` в `App.tsx`. Секции сверху вниз:

1. **Вердикт** — бейдж `LEGAL` / `ILLEGAL` из `result.valid` (зелёный / красный),
   `data-testid="verdict"`.
2. **Points-метр** — горизонтальная полоса заполнения `total/limit`; подпись
   `{total} / {limit} pts` и справа `{remaining} left` либо `over by {n}` (красным при переборе).
   Полоса при переборе красная, иначе акцентная. Элемент с подписью несёт
   `data-testid="points"`, и его текст **начинается** с `{total} / {limit}` (контракт
   builder-тестов `/^{n} \/ {limit}/`). Клик по «Edit» открывает визард на шаге Points
   (переиспользуем существующий `onEditPoints`).
3. **Армейские правила** — `result.checks` строками ✓/✗: иконка-статус, `label`, и
   `{actual} / {limit}` (табличные цифры). Зелёная строка = satisfied, красная = нет.
   `data-testid="army-checks"`. Если `checks` пуст — секция не рендерится.
4. **Проблемы** — `result.issues`, сгруппированы:
   - **Армейские** (`selectionId === undefined`) — без ссылки на юнит.
   - **Юниты** (`selectionId !== undefined`) — с именем юнита (резолв по `roster`/`catalogue`
     через уже существующий helper выбора имени, либо по `entryId` в каталоге) и кликом,
     вызывающим `onFocusUnit(selectionId)` (в `App` → `setSelectedUnitId`).
   Ошибки и предупреждения различаются цветом (`--error` / `--warn`). Пустой список — секция
   «No issues» не показывает список (или показывает нейтральное «No issues»).

**Пропсы:**

```ts
type LegalityPanelProps = {
  result: ValidationResult;                 // из evaluate()
  unitNameOf: (selectionId: string) => string | undefined; // резолв имени юнита для issue
  onEditPoints: () => void;                 // открыть визард на шаге Points
  onFocusUnit: (selectionId: string) => void;
};
```

`App.tsx`: убрать inline points-span и issues-`<ul>`, отрендерить `<LegalityPanel …>` под
`SetupBar`. `unitNameOf` строится из `roster.selections`/каталога (имя выбранного юнита по
`selectionId`). `onEditPoints = () => openWizardAt(0)`. `onFocusUnit = setSelectedUnitId`.

**CSS** — в `apps/web/src/index.css`, токенами существующей темы (`--error`, `--warn`, акцент).
Панель компактная, не перетягивает фокус с билдера.

## Границы (YAGNI)

- Только force-level армейские правила + очки в чеклисте. Юнит-локальные constraints остаются в
  списке проблем, **не** дублируются позитивными строками (их слишком много; не про армейскую
  легальность).
- Детачмент/усиления-лимиты — уже отдельные механики; не трогаем.
- Никаких новых severity, никакого изменения `valid`.
- Не коммитим реальные данные каталога — тесты движка на синтетических каталогах, веб-тесты на
  `mini40k`.

## Тестирование

- **domain:** схема `LegalityCheck`; `ValidationResult` парсит вход без `checks` (→ `[]`).
- **engine-eval:** `describeConstraint` (min satisfied/violated, max, unanchored→null, force-level
  node-relative→null); `evaluate` возвращает points-check (satisfied/over), force-check
  satisfied/violated; инвариант «force-check.satisfied=false ⇔ парный issue». 100% строк
  engine-eval (кроме `src/index.ts`).
- **web (jsdom):** панель показывает LEGAL/ILLEGAL; points-метр несёт `data-testid="points"` с
  ведущим `{total} / {limit}`; чеклист рендерит ✓/✗ по `checks`; клик по issue юнита зовёт
  `onFocusUnit`; клик Edit зовёт `onEditPoints`. Существующие builder/App-тесты остаются
  зелёными (контракт `points`).
- Весь `turbo run test` зелёный; golden парсера не затронут (изменения не касаются Rust).
