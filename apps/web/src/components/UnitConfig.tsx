import type { IrCatalogue, IrGroup, Roster, RosterSelection } from "@muster/domain";
import { optionsFor, selectedGroupMembers } from "@muster/roster";

export function UnitConfig({
  roster, selection, catalogue, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const { options, groups } = optionsFor(roster, selection.id, catalogue);
  const nameById = new Map(options.map((o) => [o.id, o.name] as const));
  const memberIds = new Set(groups.flatMap((g) => g.memberEntryIds));
  // Options that belong to no group stay freely additive.
  const freeOptions = options.filter((o) => !memberIds.has(o.id));

  return (
    <div style={{ padding: "4px 0 8px 12px" }}>
      <label>
        count:{" "}
        <input type="number" min={1} value={selection.count}
          onChange={(e) => onSetCount(selection.id, Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 56 }} />
      </label>{" "}
      <button onClick={() => onRemove(selection.id)} aria-label={`remove ${selection.entryId}`}>remove</button>

      {groups.map((g) => {
        const chosen = new Set(selectedGroupMembers(roster, selection.id, g));
        return (
          <div key={g.id} style={{ marginTop: 6 }}>
            <strong>{g.name}</strong>{" "}
            <span style={{ color: "var(--muted)" }}>
              {g.constraints.map((c) => `${c.type} ${c.value}`).join(", ")}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {g.memberEntryIds.map((id) => {
                const on = chosen.has(id);
                return (
                  <button key={id} aria-pressed={on}
                    className={on ? "chosen" : undefined}
                    aria-label={`${on ? "deselect" : "select"} ${nameById.get(id) ?? id}`}
                    onClick={() => onToggleGroupMember(selection.id, g, id)}>
                    {on ? "✓ " : ""}{nameById.get(id) ?? id}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {freeOptions.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {freeOptions.map((o) => (
            <button key={o.id} onClick={() => onAddOption(selection.id, o.id)}
              aria-label={`add option ${o.name}`}>
              + {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
