import type { IrCatalogue, IrGroup, Roster, RosterSelection } from "@muster/domain";
import { optionsFor, selectedGroupMembers, groupControl, optionControl, catalogueEntry } from "@muster/roster";

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
  // Options that belong to no group stay freely addable.
  const freeOptions = options.filter((o) => !memberIds.has(o.id));

  // How THIS selection's own count is edited, from its entry's constraints.
  const entry = catalogueEntry(catalogue, selection.entryId);
  const control = entry ? optionControl(entry) : ({ kind: "toggle" } as const);
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

  return (
    <div style={{ padding: "4px 0 8px 12px" }}>
      {control.kind === "stepper" && (
        <span style={{ marginRight: 8 }}>
          <button aria-label={`decrease ${selection.entryId}`}
            onClick={() => onSetCount(selection.id, clamp(selection.count - 1, Math.max(1, control.min), control.max))}>
            −
          </button>
          <span style={{ display: "inline-block", minWidth: 28, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
            {selection.count}
          </span>
          <button aria-label={`increase ${selection.entryId}`}
            onClick={() => onSetCount(selection.id, clamp(selection.count + 1, Math.max(1, control.min), control.max))}>
            +
          </button>
        </span>
      )}
      {control.kind === "fixed" && (
        <span style={{ marginRight: 8, color: "var(--muted)" }}>×{control.count} (fixed)</span>
      )}
      <button onClick={() => onRemove(selection.id)} aria-label={`remove ${selection.entryId}`}>remove</button>

      {groups.map((g) => {
        const ctrl = groupControl(g);
        const chosen = new Set(selectedGroupMembers(roster, selection.id, g));
        const hint = ctrl.kind === "single"
          ? (ctrl.required ? "choose 1 (required)" : "choose 1")
          : `up to ${ctrl.max === Infinity ? "any" : ctrl.max}`;
        return (
          <div key={g.id} style={{ marginTop: 6 }}>
            <strong>{g.name}</strong> <span style={{ color: "var(--muted)" }}>{hint}</span>
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
