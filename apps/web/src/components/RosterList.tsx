import type { IrCatalogue, Roster } from "@muster/domain";
import { unitsByRole, modelCount, catalogueEntry } from "@muster/roster";

/** The roster window: added units grouped by role, plus the add-unit trigger. */
export function RosterList({
  roster, catalogue, selectedUnitId, onSelect, onOpenPicker,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onSelect: (id: string) => void;
  onOpenPicker: () => void;
}) {
  const groups = unitsByRole(roster, catalogue);
  return (
    <section data-testid="roster-list" className="rl">
      <div className="rl-head">
        <h2 className="rl-title">Roster</h2>
        <button className="rl-add-open" onClick={onOpenPicker}>+ Add unit</button>
      </div>
      {groups.length === 0 && <div className="rl-empty">Roster is empty — add a unit</div>}
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
                    className={u.id === selectedUnitId ? "rl-unit selected" : "rl-unit"}
                    aria-label={`open ${name}`} onClick={() => onSelect(u.id)}>
                    <span>{name}</span>
                    <span className="rl-models">{models} model{models === 1 ? "" : "s"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
