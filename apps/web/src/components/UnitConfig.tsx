import type { IrCatalogue, IrGroup, Roster, RosterSelection } from "@muster/domain";
import { optionsFor, selectedGroupMembers, groupControl, optionControl, catalogueEntry } from "@muster/roster";

export function UnitConfig({
  roster, selection, catalogue, canRemove = true, hiddenIds, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  canRemove?: boolean;
  hiddenIds: Set<string>;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const { options: allOptions, groups } = optionsFor(roster, selection.id, catalogue);
  const options = allOptions.filter((o) => !hiddenIds.has(o.id));
  const nameById = new Map(options.map((o) => [o.id, o.name] as const));
  const memberIds = new Set(groups.flatMap((g) => g.memberEntryIds));
  const presentEntryIds = new Set(selection.selections.map((s) => s.entryId));
  // An option that is not in a group and not already present is freely addable.
  // Once added it lives as a single row edited by its own count/remove — we do
  // not re-offer it, so an entry can't be spawned as duplicate rows.
  const freeOptions = options.filter((o) => !memberIds.has(o.id) && !presentEntryIds.has(o.id));

  // How THIS selection's own count is edited, from its entry's constraints.
  const entry = catalogueEntry(catalogue, selection.entryId);
  const control = entry ? optionControl(entry) : ({ kind: "toggle" } as const);
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

  const topLevel = !canRemove;                       // depth 0 (SelectionNode passes canRemove={depth>0})
  const title = groups.length > 0 ? "Wargear Options" : "Configuration";
  const showHead = topLevel && (groups.length > 0 || freeOptions.length > 0);
  const hasSelf = control.kind === "stepper" || control.kind === "fixed" || canRemove;

  return (
    <div className={topLevel ? "uc" : "uc uc-nested"}>
      {showHead && <div className="ds-section-head">{title}</div>}

      {hasSelf && (
        <div className="uc-selfrow">
          {control.kind === "stepper" && (
            <span className="uc-stepper">
              <button aria-label={`decrease ${selection.entryId}`}
                onClick={() => onSetCount(selection.id, clamp(selection.count - 1, Math.max(1, control.min), control.max))}>
                −
              </button>
              <span className="uc-step-val">{selection.count}</span>
              <button aria-label={`increase ${selection.entryId}`}
                onClick={() => onSetCount(selection.id, clamp(selection.count + 1, Math.max(1, control.min), control.max))}>
                +
              </button>
            </span>
          )}
          {control.kind === "fixed" && (
            <span className="uc-fixed">×{control.count} fixed</span>
          )}
          {canRemove && (
            <button className="uc-remove" onClick={() => onRemove(selection.id)} aria-label={`remove ${selection.entryId}`}>
              Remove
            </button>
          )}
        </div>
      )}

      {groups.map((g) => {
        const ctrl = groupControl(g);
        const chosen = new Set(selectedGroupMembers(roster, selection.id, g));
        const required = ctrl.kind === "single" && ctrl.required;
        const hint = ctrl.kind === "single"
          ? (ctrl.required ? "choose 1 (required)" : "choose 1")
          : `up to ${ctrl.max === Infinity ? "any" : ctrl.max}`;
        return (
          <div key={g.id} className="uc-group">
            <div className="uc-group-head">
              <span className="uc-group-name">{g.name}</span>
              <span className={required ? "uc-hint is-required" : "uc-hint"}>{hint}</span>
            </div>
            <div className="uc-options">
              {g.memberEntryIds.filter((id) => !hiddenIds.has(id)).map((id) => {
                const on = chosen.has(id);
                return (
                  <button key={id} aria-pressed={on}
                    className={on ? "uc-opt chosen" : "uc-opt"}
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
        <div className="uc-adds">
          {freeOptions.map((o) => (
            <button key={o.id} className="uc-add" onClick={() => onAddOption(selection.id, o.id)}
              aria-label={`add option ${o.name}`}>
              + {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
