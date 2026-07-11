import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import { createRoster, addUnit, addOption, toggleGroupMember, setCount, remove } from "@muster/roster";
import { evaluate } from "@muster/engine-eval";
import { RosterList } from "./components/RosterList";
import { UnitDetail } from "./components/UnitDetail";
import { AddUnitPicker } from "./components/AddUnitPicker";
import mini40k from "./mini40k.ir.json";

export function App() {
  const [catalogue, setCatalogue] = useState<IrCatalogue>(() => IrCatalogueSchema.parse(mini40k));
  const [roster, setRoster] = useState(() => createRoster(catalogue, 2000));
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);

  const loadIr = async (file: File) => {
    const parsed = IrCatalogueSchema.parse(JSON.parse(await file.text()));
    setCatalogue(parsed);
    setRoster(createRoster(parsed, 2000));
    setSelectedUnitId(undefined);
    setPickerOpen(false);
  };

  // Add a unit and focus it, so its config/datasheet render immediately.
  // addUnit is called once (not in an updater) so its fresh id is knowable and
  // stable under StrictMode's double-invocation.
  const addAndSelect = (entryId: string) => {
    const next = addUnit(roster, entryId, catalogue);
    setRoster(next);
    setSelectedUnitId(next.selections[next.selections.length - 1]?.id);
    setPickerOpen(false);
  };

  const handleRemove = (id: string) => {
    const next = remove(roster, id);
    setRoster(next);
    if (!next.selections.some((s) => s.id === selectedUnitId)) setSelectedUnitId(undefined);
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Muster — {catalogue.name}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span data-testid="points" style={{ fontWeight: 700, fontSize: 20 }}>
            {result.totalPoints} / {result.pointsLimit} pts
          </span>
          <label style={{ fontSize: 13 }}>
            load IR:{" "}
            <input type="file" accept="application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadIr(f); }} />
          </label>
        </div>
      </header>
      {result.issues.length > 0 && (
        <ul style={{ margin: "4px 0" }}>
          {result.issues.map((i, idx) => (
            <li key={idx} style={{ color: i.severity === "error" ? "var(--error)" : "var(--warn)" }}>
              {i.severity}: {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="builder" data-view={selectedUnitId ? "detail" : "list"}>
        <RosterList roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onSelect={setSelectedUnitId} onOpenPicker={() => setPickerOpen(true)} />
        <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onBack={() => setSelectedUnitId(undefined)}
          onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid))}
          onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid))}
          onRemove={handleRemove}
          onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))} />
      </div>
      {pickerOpen && (
        <AddUnitPicker catalogue={catalogue} onAdd={addAndSelect} onClose={() => setPickerOpen(false)} />
      )}
    </main>
  );
}
