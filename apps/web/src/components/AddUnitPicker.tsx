import { useState } from "react";
import type { IrCatalogue, IrEntry } from "@muster/domain";
import { availableUnits } from "@muster/roster";

function points(e: IrEntry): number {
  return e.costs.find((c) => c.name === "points")?.value ?? 0;
}

/** Modal picker: the full faction unit list, grouped by role, searchable. */
export function AddUnitPicker({
  catalogue, onAdd, onClose,
}: {
  catalogue: IrCatalogue;
  onAdd: (entryId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const units = availableUnits(catalogue).filter((u) => u.name.toLowerCase().includes(q));

  const groups: { role: string; units: IrEntry[] }[] = [];
  const byRole = new Map<string, { role: string; units: IrEntry[] }>();
  for (const u of units) {
    const catId = u.categories[0];
    const role = catId === undefined ? "Other" : (catalogue.categoryNames?.[catId] ?? catId);
    let group = byRole.get(role);
    if (!group) {
      group = { role, units: [] };
      byRole.set(role, group);
      groups.push(group);
    }
    group.units.push(u);
  }

  return (
    <div className="picker-overlay" role="dialog" aria-label="add unit" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>Добавить юнит</strong>
          <button className="picker-close" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <input className="picker-search" type="search" placeholder="Поиск юнита…"
          value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="picker-list">
          {groups.length === 0 && <div className="picker-empty">Ничего не найдено</div>}
          {groups.map((g) => (
            <div key={g.role}>
              <div className="picker-role">{g.role}</div>
              {g.units.map((u) => (
                <button key={u.id} className="picker-item" aria-label={`add ${u.name}`}
                  onClick={() => onAdd(u.id)}>
                  <span>{u.name}</span>
                  <span className="picker-pts">{points(u)} pts</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
