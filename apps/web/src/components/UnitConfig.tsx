import { useMemo } from "react";
import type { IrCatalogue, IrEntry, IrGroup, Roster, RosterSelection } from "@muster/domain";
import { optionsFor, selectedGroupMembers, groupControl, optionControl, catalogueEntry,
  groupMemberCounts, groupTotal } from "@muster/roster";
import { hiddenEntryIds } from "@muster/engine-eval";

export function UnitConfig({
  roster, selection, catalogue, canRemove = true, onAddOption, onToggleGroupMember,
  onSetGroupMemberCount, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  canRemove?: boolean;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onSetGroupMemberCount: (parentId: string, group: IrGroup, entryId: string, count: number) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const hiddenIds = useMemo(
    () => hiddenEntryIds(roster, catalogue, selection.id),
    [roster, catalogue, selection.id],
  );
  const { options: allOptions, groups } = optionsFor(roster, selection.id, catalogue);
  const options = allOptions.filter((o) => !hiddenIds.has(o.id));
  const nameById = new Map(options.map((o) => [o.id, o.name] as const));
  // Member entries are resolved from the full (pre-hidden) child set: a counted
  // group reads each member's own count bounds, and a currently-chosen member must
  // resolve even if a state gate would otherwise hide it.
  const entryById = new Map(allOptions.map((o) => [o.id, o] as const));
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
          {entry?.type && <span className="uc-type">{entry.type}</span>}
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
        const memberEntries = g.memberEntryIds
          .map((id) => entryById.get(id))
          .filter((e): e is IrEntry => e !== undefined);
        const ctrl = groupControl(g, memberEntries);
        const chosen = new Set(selectedGroupMembers(roster, selection.id, g));
        // Members hidden by state (wrong detachment, character-only enhancement,
        // Crusade-only relic on a matched-play unit …) drop out. A group left with
        // no visible member is a phantom header — e.g. a vehicle carrying the whole
        // Chapter-Command / Enhancement structure it can never use — so skip it.
        const visibleMembers = g.memberEntryIds.filter((id) => !hiddenIds.has(id) || chosen.has(id));
        if (visibleMembers.length === 0) return null;

        if (ctrl.kind === "counted") {
          return (
            <CountedGroup key={g.id} group={g} visibleMembers={visibleMembers}
              min={ctrl.min} max={ctrl.max} nameById={nameById} entryById={entryById}
              total={groupTotal(roster, selection.id, g)}
              counts={groupMemberCounts(roster, selection.id, g)}
              onSet={(id, n) => onSetGroupMemberCount(selection.id, g, id, n)} />
          );
        }

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
              {visibleMembers.map((id) => {
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

/** A count-distribution group ("4-9 Terminators"): a stepper per member, each
 *  bounded by the member's own max and the group's remaining budget (max − total),
 *  with the group's [min,max] range and current total shown. Members below the min
 *  are the engine's to flag; the header only signals when the range is unmet. */
function CountedGroup({
  group, visibleMembers, min, max, nameById, entryById, total, counts, onSet,
}: {
  group: IrGroup;
  visibleMembers: string[];
  min: number;
  max: number;
  nameById: Map<string, string>;
  entryById: Map<string, IrEntry>;
  total: number;
  counts: Map<string, number>;
  onSet: (entryId: string, count: number) => void;
}) {
  const maxLabel = max === Infinity ? "any" : String(max);
  const range = min > 0 ? `${min}–${maxLabel}` : `up to ${maxLabel}`;
  const unmet = total < min || total > max;
  const remaining = max - total; // room left before the group is full (Infinity if unbounded)
  return (
    <div className="uc-group">
      <div className="uc-group-head">
        <span className="uc-group-name">{group.name}</span>
        <span className={unmet ? "uc-hint is-required" : "uc-hint"}>{range} · {total} chosen</span>
      </div>
      <div className="uc-counted">
        {visibleMembers.map((id) => {
          const entry = entryById.get(id);
          const ctrl = entry ? optionControl(entry) : ({ kind: "toggle" } as const);
          const memberMax = ctrl.kind === "stepper" ? ctrl.max : ctrl.kind === "fixed" ? ctrl.count : 1;
          const cur = counts.get(id) ?? 0;
          const canInc = cur < memberMax && remaining > 0;
          const canDec = cur > 0;
          return (
            <div key={id} className="uc-countrow">
              <span className="uc-countname">{nameById.get(id) ?? id}</span>
              <span className="uc-stepper">
                <button aria-label={`decrease ${nameById.get(id) ?? id}`} disabled={!canDec}
                  onClick={() => onSet(id, cur - 1)}>−</button>
                <span className="uc-step-val">{cur}</span>
                <button aria-label={`increase ${nameById.get(id) ?? id}`} disabled={!canInc}
                  onClick={() => onSet(id, cur + 1)}>+</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
