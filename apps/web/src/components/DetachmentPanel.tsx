import { useState } from "react";
import type { IrCatalogue, IrEntry, IrGroup, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments, detachmentRuleTexts, enhancementsForDetachment, enhancementTargets } from "@muster/roster";
import { pointsCost } from "@muster/engine-eval";

type Target = ReturnType<typeof enhancementTargets>[number];

/** One enhancement row: assigned (`on <unit>`, click to select / remove), assignable
 *  (click to assign; inline menu if several eligible units), or a muted hint. */
function EnhancementRow({ enhancement, catalogue, roster, onSelectUnit, onToggleGroupMember }: {
  enhancement: IrEntry; catalogue: IrCatalogue; roster: Roster;
  onSelectUnit: (selectionId: string) => void;
  onToggleGroupMember: (parentSelectionId: string, group: IrGroup, entryId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const targets = enhancementTargets(roster, catalogue, enhancement.id);
  const taken = targets.find((t) => t.taken);
  const pts = pointsCost(enhancement)?.value ?? 0;
  const assign = (t: Target) => { onToggleGroupMember(t.parentSelectionId, t.group, enhancement.id); onSelectUnit(t.unitSelectionId); };

  return (
    <div className="enh-line">
      {taken ? (
        <>
          <button className="enh-name enh-link" onClick={() => onSelectUnit(taken.unitSelectionId)}>{enhancement.name}</button>
          <button className="enh-on" onClick={() => onToggleGroupMember(taken.parentSelectionId, taken.group, enhancement.id)}>on {taken.unitName} ✕</button>
        </>
      ) : targets.length === 0 ? (
        <>
          <span className="enh-name">{enhancement.name}</span>
          <span className="enh-hint">Add a Character to take this</span>
        </>
      ) : targets.length === 1 ? (
        <button className="enh-name enh-link" onClick={() => assign(targets[0]!)}>{enhancement.name}</button>
      ) : (
        <span className="enh-assignable">
          <button className="enh-name enh-link" onClick={() => setMenuOpen((o) => !o)}>{enhancement.name}</button>
          {menuOpen && (
            <span className="enh-menu">
              {targets.map((t) => (
                <button key={t.parentSelectionId} onClick={() => { assign(t); setMenuOpen(false); }}>{t.unitName}</button>
              ))}
            </span>
          )}
        </span>
      )}
      <span className="enh-pts">{pts}</span>
    </div>
  );
}

/** A collapsible builder panel showing each chosen detachment's rule(s) and the
 *  enhancements it unlocks, with interactive assignment to roster Characters.
 *  Renders nothing unless the catalogue models detachments and at least one is chosen. */
export function DetachmentPanel({ catalogue, roster, onSelectUnit, onToggleGroupMember }: {
  catalogue: IrCatalogue; roster: Roster;
  onSelectUnit: (selectionId: string) => void;
  onToggleGroupMember: (parentSelectionId: string, group: IrGroup, entryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const detachments = availableDetachments(catalogue);
  const chosenIds = selectedDetachments(roster, catalogue);
  if (detachments.length === 0 || chosenIds.length === 0) return null;

  const chosen = chosenIds
    .map((id) => detachments.find((d) => d.id === id))
    .filter((d): d is IrEntry => d !== undefined);

  return (
    <div className="det-panel" data-testid="detachment-panel">
      <button className="det-panel-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="det-panel-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="det-panel-title">Detachment</span>
        <span className="det-panel-names">{chosen.map((d) => d.name).join(", ")}</span>
      </button>
      {open && (
        <div className="det-panel-body">
          {chosen.map((det) => {
            const rules = detachmentRuleTexts(catalogue, det.id);
            const enhancements = enhancementsForDetachment(catalogue, det.id);
            return (
              <div key={det.id} className="det-preview-section">
                <div className="ds-section-head">{det.name}</div>
                <div className="preview-body">
                  {rules.length > 0 && (
                    <div className="det-rules">
                      {rules.map((r) => (
                        <div key={r.name} className="det-rule">
                          <div className="det-rule-name">{r.name}</div>
                          <p className="det-rule-text">{r.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="preview-subhead">Enhancements</div>
                  {enhancements.length === 0 && <div className="preview-empty">No enhancements.</div>}
                  {enhancements.map((e) => (
                    <EnhancementRow key={e.id} enhancement={e} catalogue={catalogue} roster={roster}
                      onSelectUnit={onSelectUnit} onToggleGroupMember={onToggleGroupMember} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
