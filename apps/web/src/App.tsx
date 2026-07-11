import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import { createRoster, availableUnits, addUnit, addOption, toggleGroupMember, setCount, remove } from "@muster/roster";
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
      <UnitPalette units={availableUnits(catalogue)} onAdd={(id) => setRoster((r) => addUnit(r, id, catalogue))} />
      <RosterPanel roster={roster} catalogue={catalogue} result={result}
        onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid))}
        onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid))}
        onRemove={(id) => setRoster((r) => remove(r, id))}
        onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))} />
    </main>
  );
}
