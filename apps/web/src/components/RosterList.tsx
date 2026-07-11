import type { IrCatalogue, Roster } from "@muster/domain";
import { unitsByRole, modelCount, availableUnits, catalogueEntry } from "@muster/roster";

export function RosterList({
  roster, catalogue, selectedUnitId, onSelect, onAddUnit,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onSelect: (id: string) => void;
  onAddUnit: (entryId: string) => void;
}) {
  const groups = unitsByRole(roster, catalogue);
  return (
    <section data-testid="roster-list" className="rl">
      {groups.map((g) => (
        <div key={g.role} className="rl-group">
          <h3 className="rl-role">{g.role}</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {g.units.map((u) => {
              const name = catalogueEntry(catalogue, u.entryId)?.name ?? u.entryId;
              const models = modelCount(catalogue, u);
              return (
                <li key={u.id}>
                  <button
                    className={u.id === selectedUnitId ? "rl-unit chosen" : "rl-unit"}
                    aria-label={`open ${name}`} onClick={() => onSelect(u.id)}>
                    <span>{name}</span>
                    <span className="rl-models">{models} models</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="rl-add">
        <div className="rl-add-label">+ добавить юнит</div>
        {availableUnits(catalogue).map((u) => (
          <button key={u.id} className="rl-add-btn" aria-label={`add ${u.name}`}
            onClick={() => onAddUnit(u.id)}>
            {u.name}
          </button>
        ))}
      </div>
    </section>
  );
}
