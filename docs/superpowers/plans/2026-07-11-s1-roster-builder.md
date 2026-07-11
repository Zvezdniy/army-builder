# S1: хребет ростера + тонкий веб-билдер — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать возможность собирать ростер в браузере — добавлять юниты, настраивать оружие, видеть живые очки и валидацию — на настоящем `engine-eval`.

**Architecture:** Новый чистый пакет `@muster/roster` (иммутабельное редактирование ростера + «что доступно») поверх существующих `@muster/domain` + `@muster/engine-eval`. Новое приложение `apps/web` (Vite+React) держит один `Roster` в состоянии, зовёт функции `@muster/roster` на мутациях и `evaluate()` для отображения. Домен и engine-eval не трогаем.

**Tech Stack:** TypeScript (strict, ESM), Zod (типы), Vitest (тесты), Vite + React 18 (веб).

## Global Constraints

- Строгий TS (`strict`, `noUncheckedIndexedAccess`); ESM (`"type": "module"`).
- Пакеты `@muster/*` экспортируют TS-исходник напрямую (`"exports": { ".": "./src/index.ts" }`), без сборки; workspace-импорты резолвятся `vite-tsconfig-paths` через `tsconfig.base.json` `paths`.
- `@muster/roster` — чистый, **иммутабельный** (каждая функция возвращает новый `Roster`), покрытие тестами **100%** (statements/branches/functions/lines; `src/index.ts` исключён), как у домена/engine-eval (общий `vitest.shared.ts`).
- `apps/web` — **не** под 100%-порогом: свой `vitest.config.ts` с `environment: "jsdom"` без coverage thresholds.
- **Не трогать** `packages/domain`, `packages/engine-eval` (только зависеть). `evaluate(roster, catalogue): ValidationResult` — как есть.
- Идентификаторы селекций — `crypto.randomUUID()` (есть в node18+ и браузере).
- Код/идентификаторы/коммиты — на английском.
- Реальные GW-данные в git не идут; дефолтный каталог — копия golden `mini40k.ir.json`.

## Типы (существуют в `@muster/domain`, для справки)

- `IrCatalogue { id, name, gameSystemId, revision, entries: IrEntry[], forceConstraints: IrConstraint[] }`
- `IrEntry { id, name, costs: IrCost[], categories: string[], constraints: IrConstraint[], children: IrEntry[], groups?: IrGroup[] }`
- `IrGroup { id, name, memberEntryIds: string[], constraints: IrGroupConstraint[] }`
- `Roster { id, name, gameSystemId, catalogueId, catalogueRevision, pointsLimit, selections: RosterSelection[], overrides? }`
- `RosterSelection { id, entryId, count, selections: RosterSelection[] }`
- `ValidationResult { valid, totalPoints, pointsLimit, issues: Issue[], dismissed, hasHouseRules }`
- `evaluate(roster, catalogue): ValidationResult` из `@muster/engine-eval`.

## Файловая структура

- **Create** `packages/roster/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/builder.test.ts}`
- **Modify** `tsconfig.base.json` — путь `@muster/roster`.
- **Create** `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html,src/main.tsx,src/App.tsx,src/mini40k.ir.json,src/setupTests.ts}`
- **Create** `apps/web/src/components/{UnitPalette.tsx,RosterPanel.tsx,UnitConfig.tsx}` и тесты `apps/web/src/*.test.tsx`

Все команды — из корня репозитория, если не сказано иначе.

---

## Task 1: пакет `@muster/roster` (редактирование + доступность)

**Files:**
- Create: `packages/roster/package.json`, `packages/roster/tsconfig.json`, `packages/roster/vitest.config.ts`, `packages/roster/src/index.ts`, `packages/roster/src/builder.test.ts`
- Modify: `tsconfig.base.json`

**Interfaces:**
- Produces: `createRoster`, `availableUnits`, `addUnit`, `addOption`, `setCount`, `remove`, `optionsFor` (сигнатуры ниже) — потребляются `apps/web`.

- [ ] **Step 1: Каркас пакета**

`packages/roster/package.json`:
```json
{
  "name": "@muster/roster",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@muster/domain": "workspace:*"
  }
}
```

`packages/roster/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/roster/vitest.config.ts`:
```ts
import shared from "../../vitest.shared";

export default shared;
```

В `tsconfig.base.json` в `compilerOptions.paths` добавить строку (рядом с существующими):
```json
      "@muster/roster": ["packages/roster/src/index.ts"],
```

- [ ] **Step 2: Написать падающие тесты**

`packages/roster/src/builder.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import {
  createRoster, availableUnits, addUnit, addOption, setCount, remove, optionsFor,
} from "./index";

const catalogue: IrCatalogue = {
  id: "cat", name: "Cat", gameSystemId: "gs", revision: 1,
  forceConstraints: [],
  entries: [
    {
      id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
      categories: ["cat.hq"], constraints: [],
      children: [{ id: "e.bolter", name: "Bolter", costs: [], categories: [], constraints: [], children: [] }],
      groups: [{ id: "g.wpn", name: "Weapon", memberEntryIds: ["e.bolter"], constraints: [{ id: "gc", type: "max", value: 1 }] }],
    },
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: [], constraints: [], children: [], groups: [] },
  ],
};

describe("roster builder", () => {
  it("createRoster seeds catalogue linkage and empty selections", () => {
    const r = createRoster(catalogue, 2000, "My List");
    expect(r.catalogueId).toBe("cat");
    expect(r.gameSystemId).toBe("gs");
    expect(r.catalogueRevision).toBe(1);
    expect(r.pointsLimit).toBe(2000);
    expect(r.name).toBe("My List");
    expect(r.selections).toEqual([]);
  });

  it("createRoster uses a default name when omitted", () => {
    expect(createRoster(catalogue, 1000).name).toBe("New Roster");
  });

  it("availableUnits returns catalogue roots", () => {
    expect(availableUnits(catalogue).map((e) => e.id)).toEqual(["e.captain", "e.squad"]);
  });

  it("addUnit appends a root selection immutably", () => {
    const r0 = createRoster(catalogue, 2000);
    const r1 = addUnit(r0, "e.captain");
    expect(r0.selections).toEqual([]); // original untouched
    expect(r1.selections).toHaveLength(1);
    expect(r1.selections[0]!.entryId).toBe("e.captain");
    expect(r1.selections[0]!.count).toBe(1);
  });

  it("addOption nests a child under the target selection", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    expect(r.selections[0]!.selections[0]!.entryId).toBe("e.bolter");
  });

  it("setCount updates a nested selection's count", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.squad");
    const id = r.selections[0]!.id;
    r = setCount(r, id, 10);
    expect(r.selections[0]!.count).toBe(10);
  });

  it("remove drops a selection and its subtree", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    r = remove(r, capId);
    expect(r.selections).toEqual([]);
  });

  it("remove of a nested option keeps the parent", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    const optId = r.selections[0]!.selections[0]!.id;
    r = remove(r, optId);
    expect(r.selections).toHaveLength(1);
    expect(r.selections[0]!.selections).toEqual([]);
  });

  it("optionsFor returns the entry's children and groups", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const id = r.selections[0]!.id;
    const { options, groups } = optionsFor(r, id, catalogue);
    expect(options.map((o) => o.id)).toEqual(["e.bolter"]);
    expect(groups.map((g) => g.id)).toEqual(["g.wpn"]);
  });

  it("optionsFor is empty for an unknown selection id", () => {
    const r = createRoster(catalogue, 2000);
    expect(optionsFor(r, "nope", catalogue)).toEqual({ options: [], groups: [] });
  });

  it("optionsFor is empty when the entry is missing from the catalogue", () => {
    // selection references an entryId not present in the catalogue
    const r: ReturnType<typeof createRoster> = {
      ...createRoster(catalogue, 2000),
      selections: [{ id: "s1", entryId: "ghost", count: 1, selections: [] }],
    };
    expect(optionsFor(r, "s1", catalogue)).toEqual({ options: [], groups: [] });
  });

  it("optionsFor yields empty groups when entry has no groups", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.squad");
    const id = r.selections[0]!.id;
    expect(optionsFor(r, id, catalogue).groups).toEqual([]);
  });
});
```

- [ ] **Step 3: Запустить — упадёт (нет `./index`)**

Run: `pnpm --filter @muster/roster test`
Expected: FAIL — модуль/функции не найдены.

- [ ] **Step 4: Реализовать `packages/roster/src/index.ts`**

```ts
import type { IrCatalogue, IrEntry, IrGroup, Roster, RosterSelection } from "@muster/domain";

/** Create an empty roster bound to a catalogue. */
export function createRoster(catalogue: IrCatalogue, pointsLimit: number, name = "New Roster"): Roster {
  return {
    id: crypto.randomUUID(),
    name,
    gameSystemId: catalogue.gameSystemId,
    catalogueId: catalogue.id,
    catalogueRevision: catalogue.revision,
    pointsLimit,
    selections: [],
  };
}

/** Units addable at the roster root (the catalogue's top-level entries). */
export function availableUnits(catalogue: IrCatalogue): IrEntry[] {
  return catalogue.entries;
}

/** Append a root unit selection. */
export function addUnit(roster: Roster, entryId: string): Roster {
  return { ...roster, selections: [...roster.selections, freshSelection(entryId)] };
}

/** Nest an option (child selection) under the selection with `parentSelectionId`. */
export function addOption(roster: Roster, parentSelectionId: string, entryId: string): Roster {
  return {
    ...roster,
    selections: mapTree(roster.selections, parentSelectionId, (s) => ({
      ...s,
      selections: [...s.selections, freshSelection(entryId)],
    })),
  };
}

/** Set a selection's model count. */
export function setCount(roster: Roster, selectionId: string, count: number): Roster {
  return { ...roster, selections: mapTree(roster.selections, selectionId, (s) => ({ ...s, count })) };
}

/** Remove a selection and its subtree. */
export function remove(roster: Roster, selectionId: string): Roster {
  return { ...roster, selections: removeTree(roster.selections, selectionId) };
}

/** What can be added under a selection: the entry's child options and its choose-N groups. */
export function optionsFor(
  roster: Roster,
  selectionId: string,
  catalogue: IrCatalogue,
): { options: IrEntry[]; groups: IrGroup[] } {
  const sel = findTree(roster.selections, selectionId);
  if (!sel) return { options: [], groups: [] };
  const entry = findEntry(catalogue, sel.entryId);
  if (!entry) return { options: [], groups: [] };
  return { options: entry.children, groups: entry.groups ?? [] };
}

function freshSelection(entryId: string): RosterSelection {
  return { id: crypto.randomUUID(), entryId, count: 1, selections: [] };
}

function mapTree(
  sels: RosterSelection[],
  id: string,
  fn: (s: RosterSelection) => RosterSelection,
): RosterSelection[] {
  return sels.map((s) =>
    s.id === id ? fn(s) : { ...s, selections: mapTree(s.selections, id, fn) },
  );
}

function removeTree(sels: RosterSelection[], id: string): RosterSelection[] {
  return sels
    .filter((s) => s.id !== id)
    .map((s) => ({ ...s, selections: removeTree(s.selections, id) }));
}

function findTree(sels: RosterSelection[], id: string): RosterSelection | undefined {
  for (const s of sels) {
    if (s.id === id) return s;
    const found = findTree(s.selections, id);
    if (found) return found;
  }
  return undefined;
}

function findEntry(catalogue: IrCatalogue, entryId: string): IrEntry | undefined {
  const stack: IrEntry[] = [...catalogue.entries];
  while (stack.length > 0) {
    const e = stack.pop() as IrEntry;
    if (e.id === entryId) return e;
    stack.push(...e.children);
  }
  return undefined;
}
```

- [ ] **Step 5: Установить и прогнать тесты (100% покрытие)**

Run: `pnpm install && pnpm --filter @muster/roster test`
Expected: все тесты PASS; покрытие 100% (иначе suite падает).

- [ ] **Step 6: Типчек**

Run: `pnpm --filter @muster/roster typecheck`
Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
git add packages/roster tsconfig.base.json pnpm-lock.yaml
git commit -m "feat(roster): immutable roster editing + availability layer"
```

---

## Task 2: `apps/web` — каркас Vite+React на настоящем движке

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/mini40k.ir.json`, `apps/web/src/setupTests.ts`, `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `@muster/roster` (Task 1), `@muster/engine-eval` `evaluate`, `@muster/domain` `IrCatalogue`.
- Produces: работающий dev-сервер, компонент `App` (расширяется в Task 3).

- [ ] **Step 1: Каркас приложения**

`apps/web/package.json`:
```json
{
  "name": "@muster/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@muster/domain": "workspace:*",
    "@muster/engine-eval": "workspace:*",
    "@muster/roster": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.5.0",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "jsdom": "^25.0.1",
    "vite": "^5.4.8"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"] },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
});
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
```

`apps/web/src/setupTests.ts`:
```ts
import "@testing-library/jest-dom";
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Muster — Roster Builder</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 2: Дефолтный каталог**

Скопировать golden IR в приложение:
```bash
cp packages/engine-parser/tests/fixtures/golden/mini40k.ir.json apps/web/src/mini40k.ir.json
```

- [ ] **Step 3: Написать падающий smoke-тест**

`apps/web/src/App.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the points bar from the real engine", () => {
    render(<App />);
    // Fresh roster on mini40k: 0 points against a default limit.
    expect(screen.getByTestId("points")).toHaveTextContent(/0\s*\/\s*2000/);
  });
});
```

- [ ] **Step 4: Реализовать минимальный `App.tsx` (движок вживую)**

`apps/web/src/App.tsx`:
```tsx
import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import { createRoster } from "@muster/roster";
import { evaluate } from "@muster/engine-eval";
import mini40k from "./mini40k.ir.json";

export function App() {
  const [catalogue] = useState<IrCatalogue>(() => IrCatalogueSchema.parse(mini40k));
  const [roster] = useState(() => createRoster(catalogue, 2000));
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1>Muster — {catalogue.name}</h1>
      <div data-testid="points">
        {result.totalPoints} / {result.pointsLimit} pts
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Установить и прогнать smoke-тест**

Run: `pnpm install && pnpm --filter @muster/web test`
Expected: `App` тест PASS (`0 / 2000`).

- [ ] **Step 6: Проверить сборку и типы**

Run: `pnpm --filter @muster/web typecheck && pnpm --filter @muster/web build`
Expected: без ошибок; `vite build` создаёт `apps/web/dist`.

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Vite+React shell running the real evaluate() on mini40k"
```

---

## Task 3: интерактивный билдер (палитра, ростер, настройка юнита)

**Files:**
- Create: `apps/web/src/components/UnitPalette.tsx`, `apps/web/src/components/RosterPanel.tsx`, `apps/web/src/components/UnitConfig.tsx`, `apps/web/src/builder.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `@muster/roster` все функции, `evaluate`.
- Produces: интерактивный экран (добавление юнита меняет очки; настройка опций; удаление).

- [ ] **Step 1: Написать падающий тест взаимодействия**

`apps/web/src/builder.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("builder interactions", () => {
  it("adding a unit raises the live points total", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("points")).toHaveTextContent(/^0 \/ 2000/);
    // Captain (90 pts) in the palette
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^90 \/ 2000/);
    // it now appears in the roster panel
    expect(screen.getByTestId("roster-list")).toHaveTextContent("Captain");
  });
});
```

Добавить `@testing-library/user-event` в devDependencies `apps/web/package.json`:
```json
    "@testing-library/user-event": "^14.5.2",
```

- [ ] **Step 2: Запустить — упадёт (нет палитры/кнопок)**

Run: `pnpm install && pnpm --filter @muster/web test builder`
Expected: FAIL — кнопки "add Captain" нет.

- [ ] **Step 3: Компонент палитры**

`apps/web/src/components/UnitPalette.tsx`:
```tsx
import type { IrEntry } from "@muster/domain";

function points(e: IrEntry): number {
  return e.costs.find((c) => c.name === "points")?.value ?? 0;
}

export function UnitPalette({ units, onAdd }: { units: IrEntry[]; onAdd: (entryId: string) => void }) {
  return (
    <section>
      <h2>Units</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {units.map((u) => (
          <li key={u.id}>
            <button onClick={() => onAdd(u.id)} aria-label={`add ${u.name}`}
              style={{ width: "100%", textAlign: "left", padding: 8, cursor: "pointer" }}>
              {u.name} — {points(u)} pts
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Компонент настройки юнита**

`apps/web/src/components/UnitConfig.tsx`:
```tsx
import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";
import { optionsFor } from "@muster/roster";

export function UnitConfig({
  roster, selection, catalogue, onAddOption, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  onAddOption: (parentId: string, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const { options, groups } = optionsFor(roster, selection.id, catalogue);
  return (
    <div style={{ padding: "4px 0 8px 12px" }}>
      <label>
        count:{" "}
        <input type="number" min={1} value={selection.count}
          onChange={(e) => onSetCount(selection.id, Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 56 }} />
      </label>{" "}
      <button onClick={() => onRemove(selection.id)} aria-label={`remove ${selection.entryId}`}>remove</button>
      {groups.map((g) => (
        <div key={g.id} style={{ marginTop: 4 }}>
          <strong>{g.name}</strong>{" "}
          {g.constraints.map((c) => `${c.type} ${c.value}`).join(", ")}
        </div>
      ))}
      {options.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => onAddOption(selection.id, o.id)}
              aria-label={`add option ${o.name}`} style={{ marginRight: 4 }}>
              + {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Компонент панели ростера**

`apps/web/src/components/RosterPanel.tsx`:
```tsx
import type { IrCatalogue, Roster, ValidationResult } from "@muster/domain";
import { UnitConfig } from "./UnitConfig";

export function RosterPanel({
  roster, catalogue, result, onAddOption, onRemove, onSetCount,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  result: ValidationResult;
  onAddOption: (parentId: string, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const nameOf = (entryId: string) => roster.selections.length
    ? catalogue.entries.find((e) => e.id === entryId)?.name ?? entryId
    : entryId;
  return (
    <section>
      <h2>Roster</h2>
      <div data-testid="points" style={{ fontWeight: 700, fontSize: 20 }}>
        {result.totalPoints} / {result.pointsLimit} pts
      </div>
      <ul data-testid="roster-list" style={{ listStyle: "none", padding: 0 }}>
        {roster.selections.map((s) => (
          <li key={s.id} style={{ borderTop: "1px solid #ccc", paddingTop: 6, marginTop: 6 }}>
            <strong>{nameOf(s.entryId)}</strong>
            <UnitConfig roster={roster} selection={s} catalogue={catalogue}
              onAddOption={onAddOption} onRemove={onRemove} onSetCount={onSetCount} />
          </li>
        ))}
      </ul>
      <h3>Validation</h3>
      {result.issues.length === 0 ? (
        <div>✓ no issues</div>
      ) : (
        <ul>
          {result.issues.map((i, idx) => (
            <li key={idx} style={{ color: i.severity === "error" ? "#b00" : "#a60" }}>
              {i.severity}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Связать всё в `App.tsx`**

Заменить `apps/web/src/App.tsx` на:
```tsx
import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import { createRoster, availableUnits, addUnit, addOption, setCount, remove } from "@muster/roster";
import { evaluate } from "@muster/engine-eval";
import { UnitPalette } from "./components/UnitPalette";
import { RosterPanel } from "./components/RosterPanel";
import mini40k from "./mini40k.ir.json";

export function App() {
  const [catalogue, setCatalogue] = useState<IrCatalogue>(() => IrCatalogueSchema.parse(mini40k));
  const [roster, setRoster] = useState(() => createRoster(catalogue, 2000));
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);

  const loadIr = async (file: File) => {
    const parsed = IrCatalogueSchema.parse(JSON.parse(await file.text()));
    setCatalogue(parsed);
    setRoster(createRoster(parsed, 2000));
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Muster — {catalogue.name}</h1>
        <label style={{ fontSize: 13 }}>
          load IR:{" "}
          <input type="file" accept="application/json"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadIr(f); }} />
        </label>
      </div>
      <UnitPalette units={availableUnits(catalogue)} onAdd={(id) => setRoster((r) => addUnit(r, id))} />
      <RosterPanel roster={roster} catalogue={catalogue} result={result}
        onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid))}
        onRemove={(id) => setRoster((r) => remove(r, id))}
        onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))} />
    </main>
  );
}
```

- [ ] **Step 7: Установить и прогнать тесты взаимодействия + весь app-набор**

Run: `pnpm install && pnpm --filter @muster/web test`
Expected: `builder` и `App` тесты PASS (добавление Captain → `90 / 2000`, "Captain" в списке).

- [ ] **Step 8: Типы + сборка + весь монорепо-набор**

Run: `pnpm --filter @muster/web typecheck && pnpm --filter @muster/web build && pnpm test`
Expected: без ошибок; `turbo run test` — все пакеты зелёные (домен/eval/roster 100%, web smoke).

- [ ] **Step 9: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): interactive thin roster builder (palette, roster panel, unit config)"
```

---

## Self-Review

**Покрытие спеки:**
- `@muster/roster` (createRoster/availableUnits/addUnit/addOption/setCount/remove/optionsFor, иммутабельно, 100%) — Task 1.
- Тонкий веб на настоящем `evaluate()` — Task 2 (каркас) + Task 3 (интерактив).
- Палитра юнитов / ростер с очками+валидацией / настройка оружия (группы «выбери-N»), число моделей, удаление — Task 3.
- Дефолт mini40k + загрузка своего IR (валидация Zod) — Task 2 (копия) + Task 3 (`loadIr`).
- Домен/engine-eval не тронуты — только зависимости.

**Плейсхолдеры:** нет — весь код (пакет, конфиги, компоненты) приведён целиком.

**Согласованность типов:** сигнатуры `@muster/roster` совпадают между Task 1 (Produces + определение + тесты) и вызовами в `App.tsx`/компонентах (Task 3). `evaluate(roster, catalogue)` и `ValidationResult`/`IrEntry`/`IrGroup`/`Roster`/`RosterSelection` — из домена, поля сверены (`totalPoints`, `pointsLimit`, `issues[].severity/message`, `costs[].name==="points"`, `groups[].constraints[].type/value`). `data-testid="points"` определён в `RosterPanel` (Task 3) и в минимальном `App` (Task 2) — оба теста ссылаются на него консистентно.

**Замечание по эволюции:** Task 2 определяет `data-testid="points"` в минимальном `App`; Task 3 переносит его в `RosterPanel`. Тест `App.test.tsx` (Task 2) остаётся валиден (points всё ещё в DOM). ОК.

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-07-11-s1-roster-builder.md`. Два варианта исполнения:

1. **Subagent-Driven (рекомендую)** — свежий сабагент на задачу, ревью между задачами.
2. **Inline Execution** — задачи в этой сессии через executing-plans, чекпойнты.

Какой подход?
