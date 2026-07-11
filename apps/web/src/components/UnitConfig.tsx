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
