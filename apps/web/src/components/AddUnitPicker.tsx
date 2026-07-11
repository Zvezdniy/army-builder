import { useState } from "react";
import type { IrCatalogue, IrEntry } from "@muster/domain";
import { availableUnits } from "@muster/roster";

function points(e: IrEntry): number {
  return e.costs.find((c) => c.name === "points")?.value ?? 0;
}

/** Modal picker: the full faction unit list in collapsible role sections,
 *  searchable, each unit quick-added via its "+" button. */
export function AddUnitPicker({
  catalogue, onAdd, onClose,
}: {
  catalogue: IrCatalogue;
  onAdd: (entryId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  const toggle = (role: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

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
          {groups.map((g) => {
            const open = !collapsed.has(g.role);
            return (
              <div key={g.role} className="picker-section">
                <button className="picker-role-head" aria-expanded={open} onClick={() => toggle(g.role)}>
                  <span>{g.role}</span>
                  <span className="picker-chevron">{open ? "▾" : "▸"}</span>
                </button>
                {open && g.units.map((u) => (
                  <div key={u.id} className="picker-item">
                    <span className="picker-item-name">{u.name}</span>
                    <span className="picker-pts">{points(u)} pts</span>
                    <button className="picker-add" aria-label={`add ${u.name}`} onClick={() => onAdd(u.id)}>+</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
