import { useState } from "react";
import type { IrCatalogue, IrEntry, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments, detachmentRuleTexts, enhancementsForDetachment } from "@muster/roster";
import { pointsCost } from "@muster/engine-eval";

/** A collapsible builder panel showing each chosen detachment's rule(s) and the
 *  enhancements it unlocks (read-only). Renders nothing unless the catalogue models
 *  detachments and at least one is chosen. Reuses the wizard's content CSS classes. */
export function DetachmentPanel({ catalogue, roster }: { catalogue: IrCatalogue; roster: Roster }) {
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
                    <div key={e.id} className="enh-line">
                      <span className="enh-name">{e.name}</span>
                      <span className="enh-pts">{pointsCost(e)?.value ?? 0}</span>
                    </div>
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
