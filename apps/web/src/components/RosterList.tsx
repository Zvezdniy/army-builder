import { useMemo } from "react";
import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";
import { unitsByRole, modelCount, catalogueEntry } from "@muster/roster";
import { unitBreakdowns, type UnitBreakdown } from "../rosterCards";

function unitHasHiddenSelection(
  sel: { id: string; selections: { id: string; selections: unknown[] }[] },
  hidden: Set<string>,
): boolean {
  if (hidden.has(sel.id)) return true;
  return sel.selections.some((c) => unitHasHiddenSelection(c as typeof sel, hidden));
}

/** The roster window: added units grouped by role, plus the add-unit trigger.
 *  Each unit card carries its points, model count, paid wargear, enhancements, and a
 *  Warlord tag (War Organ-style). An attached Leader is drawn under its Bodyguard. */
export function RosterList({
  roster, catalogue, selectedUnitId, onSelect, onOpenPicker, onOpenExport, hiddenIds,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onSelect: (id: string) => void;
  onOpenPicker: () => void;
  onOpenExport?: () => void;
  hiddenIds?: Set<string>;
}) {
  const hidden = hiddenIds ?? new Set<string>();
  const groups = unitsByRole(roster, catalogue);
  const breakdowns = useMemo(() => unitBreakdowns(roster, catalogue), [roster, catalogue]);
  const attachedByHost = new Map<string, RosterSelection[]>();
  for (const s of roster.selections) {
    if (s.attachedTo !== undefined) {
      const list = attachedByHost.get(s.attachedTo) ?? [];
      list.push(s);
      attachedByHost.set(s.attachedTo, list);
    }
  }
  const chips = (u: RosterSelection) => {
    const models = modelCount(catalogue, u);
    const b: UnitBreakdown | undefined = breakdowns.get(u.id);
    return (
      <span className="rl-chips">
        <span className="rl-chip rl-chip-pts">{b?.points ?? 0} pts</span>
        {models > 1 && <span className="rl-chip rl-chip-models">{models} models</span>}
        {roster.warlordId === u.id && <span className="rl-chip rl-chip-warlord">Warlord</span>}
        {(b?.enhancements ?? []).map((e) => (
          <span key={`e-${e.id}`} className="rl-chip rl-chip-enh">{e.name} · {e.points} pts</span>
        ))}
        {(b?.wargear ?? []).map((w) => (
          <span key={`w-${w.id}`} className="rl-chip rl-chip-wargear">
            {w.count > 1 ? `${w.count}× ` : ""}{w.name} · {w.points} pts
          </span>
        ))}
      </span>
    );
  };
  const renderUnitButton = (u: RosterSelection, extraClass = "", leading = false) => {
    const name = catalogueEntry(catalogue, u.entryId)?.name ?? u.entryId;
    const flagged = unitHasHiddenSelection(u, hidden);
    return (
      <button
        className={`${u.id === selectedUnitId ? "rl-unit selected" : "rl-unit"}${extraClass ? " " + extraClass : ""}`}
        aria-label={`open ${name}`} onClick={() => onSelect(u.id)}>
        <span className="rl-unit-top">
          <span className="rl-unit-name">{leading ? `↳ ${name} (leading)` : name}</span>
          {flagged && (
            <span className="rl-warn" title="Contains a selection not available in the current army configuration">⚠</span>
          )}
        </span>
        {chips(u)}
      </button>
    );
  };
  return (
    <section data-testid="roster-list" className="rl">
      <div className="rl-head">
        <h2 className="rl-title">Roster</h2>
        <div className="rl-head-actions">
          {onOpenExport && <button className="rl-copy" onClick={onOpenExport}>Export</button>}
          <button className="rl-add-open" onClick={onOpenPicker}>+ Add unit</button>
        </div>
      </div>
      {groups.length === 0 && <div className="rl-empty">Roster is empty — add a unit</div>}
      {groups.map((g) => {
        const units = g.units.filter((u) => u.attachedTo === undefined);
        if (units.length === 0) return null;
        return (
          <div key={g.role} className="rl-group">
            <h3 className="rl-role">{g.role}</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {units.map((u) => (
                <li key={u.id}>
                  {renderUnitButton(u)}
                  {(attachedByHost.get(u.id) ?? []).map((leader) => (
                    <div key={leader.id} className="rl-leader">
                      {renderUnitButton(leader, "rl-leading", true)}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
