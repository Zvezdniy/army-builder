import { useState } from "react";
import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";
import { unitsByRole, modelCount, catalogueEntry } from "@muster/roster";
import { rosterToText } from "../rosterText";

function unitHasHiddenSelection(
  sel: { id: string; selections: { id: string; selections: unknown[] }[] },
  hidden: Set<string>,
): boolean {
  if (hidden.has(sel.id)) return true;
  return sel.selections.some((c) => unitHasHiddenSelection(c as typeof sel, hidden));
}

/** The roster window: added units grouped by role, plus the add-unit trigger.
 *  An attached Leader is drawn under its Bodyguard (and omitted from its own bucket). */
export function RosterList({
  roster, catalogue, selectedUnitId, onSelect, onOpenPicker, hiddenIds,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onSelect: (id: string) => void;
  onOpenPicker: () => void;
  hiddenIds?: Set<string>;
}) {
  const hidden = hiddenIds ?? new Set<string>();
  const groups = unitsByRole(roster, catalogue);
  const [copied, setCopied] = useState(false);
  const copyList = () => {
    // navigator.clipboard is absent in some contexts (insecure origin, older
    // browsers) — no-op rather than throw, per the copy-as-text spec.
    if (!navigator.clipboard) return;
    const text = rosterToText(roster, catalogue, { pointsLimit: roster.pointsLimit });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const attachedByHost = new Map<string, RosterSelection[]>();
  for (const s of roster.selections) {
    if (s.attachedTo !== undefined) {
      const list = attachedByHost.get(s.attachedTo) ?? [];
      list.push(s);
      attachedByHost.set(s.attachedTo, list);
    }
  }
  const renderUnitButton = (u: RosterSelection, extraClass = "", leading = false) => {
    const name = catalogueEntry(catalogue, u.entryId)?.name ?? u.entryId;
    const models = modelCount(catalogue, u);
    const flagged = unitHasHiddenSelection(u, hidden);
    return (
      <button
        className={`${u.id === selectedUnitId ? "rl-unit selected" : "rl-unit"}${extraClass ? " " + extraClass : ""}`}
        aria-label={`open ${name}`} onClick={() => onSelect(u.id)}>
        <span>{leading ? `↳ ${name} (leading)` : name}</span>
        {flagged && (
          <span className="rl-warn" title="Contains a selection not available in the current army configuration">⚠</span>
        )}
        <span className="rl-models">{models} model{models === 1 ? "" : "s"}</span>
      </button>
    );
  };
  return (
    <section data-testid="roster-list" className="rl">
      <div className="rl-head">
        <h2 className="rl-title">Roster</h2>
        <div className="rl-head-actions">
          <button className="rl-copy" onClick={copyList}>{copied ? "Copied!" : "Copy list"}</button>
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
