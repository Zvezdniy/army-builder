import { useState } from "react";
import type { IrCatalogue, IrEntry, IrGroup, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachment, catalogueEntry } from "@muster/roster";
import { pointsCost } from "@muster/engine-eval";
import type { CatalogueDescriptor } from "../registry/catalogueRegistry";

const POINTS_PRESETS = [1000, 1500, 2000];

/** The enhancements a detachment unlocks: the members of its "<name> Enhancements"
 *  group (best-effort by group name — informational preview only). */
function enhancementsFor(catalogue: IrCatalogue, detachmentName: string): IrEntry[] {
  const wanted = `${detachmentName} Enhancements`;
  const stack: IrEntry[] = [...catalogue.entries];
  let group: IrGroup | undefined;
  while (stack.length > 0 && !group) {
    const e = stack.pop() as IrEntry;
    group = (e.groups ?? []).find((g) => g.name === wanted);
    stack.push(...e.children);
  }
  if (!group) return [];
  return group.memberEntryIds
    .map((id) => catalogueEntry(catalogue, id))
    .filter((e): e is IrEntry => e !== undefined);
}

const STEPS = ["Points", "Faction", "Detachment"] as const;

/** First-run army setup: points → faction (placeholder) → detachment. Controlled —
 *  reads live roster/catalogue, applies each choice immediately via callbacks. */
export function SetupWizard({
  catalogue, roster, initialStep = 0, onSetPoints, onSetDetachment, onClose,
  registry, activeDescriptorId, onSelectFaction, factionError,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  initialStep?: number;
  onSetPoints: (n: number) => void;
  onSetDetachment: (entryId: string) => void;
  onClose: () => void;
  registry?: CatalogueDescriptor[];
  activeDescriptorId?: string;
  onSelectFaction?: (descriptorId: string) => void;
  factionError?: string;
}) {
  const detachments = availableDetachments(catalogue);
  const hasDetachmentStep = detachments.length > 0;
  const lastStep = hasDetachmentStep ? 2 : 1;
  const [step, setStep] = useState(Math.min(initialStep, lastStep));
  const chosen = selectedDetachment(roster, catalogue);
  const [customPts, setCustomPts] = useState("");

  // Edition list derived from the registry, first-appearance order preserved.
  const editions = registry
    ? registry.reduce<{ id: string; name: string }[]>((acc, d) => (
        acc.some((e) => e.id === d.edition) ? acc : [...acc, { id: d.edition, name: d.editionName }]
      ), [])
    : [];
  const activeEdition = registry?.find((d) => d.id === activeDescriptorId)?.edition ?? editions[0]?.id;
  // `undefined` means "the user hasn't picked an edition locally yet" — the displayed
  // edition then tracks `activeEdition` for free. Once the user clicks a segment this
  // holds their explicit choice instead. A useEffect to resync on `activeEdition` changes
  // would fight that explicit choice (e.g. right after `onSelectFaction` updates the active
  // descriptor), so we deliberately don't add one — the derived fallback covers it.
  const [edition, setEdition] = useState<string | undefined>(undefined);
  const displayedEdition = edition ?? activeEdition;

  const canFinish = !hasDetachmentStep || chosen !== undefined;
  const next = () => (step < lastStep ? setStep(step + 1) : onClose());
  const preview = (() => {
    const d = detachments.find((x) => x.id === chosen);
    return d ? enhancementsFor(catalogue, d.name) : [];
  })();

  return (
    <div className="picker-overlay" role="dialog" aria-label="army setup"
      onClick={onClose}>
      <div className="wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-head">
          <strong>New army — setup</strong>
          <button className="picker-close" aria-label="close" onClick={onClose}>✕</button>
        </div>

        <div className="steps">
          {STEPS.slice(0, lastStep + 1).map((label, i) => (
            <button key={label} className={`step-tab${i === step ? " active" : ""}${i < step ? " done" : ""}`}
              aria-current={i === step} onClick={() => (i <= step ? setStep(i) : undefined)}>
              <span className="dot">{i + 1}</span><span className="step-lbl">{label}</span>
            </button>
          ))}
        </div>

        <div className="wizard-body">
          {step === 0 && (
            <div data-testid="step-points">
              <p className="wizard-lead">Pick the matched-play points limit.</p>
              <div className="uc-options">
                {POINTS_PRESETS.map((p) => (
                  <button key={p} className={`uc-opt${roster.pointsLimit === p ? " chosen" : ""}`}
                    onClick={() => { setCustomPts(""); onSetPoints(p); }}>{p} pts</button>
                ))}
              </div>
              <div className="wizard-field">
                <span className="wizard-hint">or custom:</span>
                <input type="number" min={0} step={5} aria-label="custom points" value={customPts}
                  onChange={(e) => {
                    setCustomPts(e.target.value);
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v > 0) onSetPoints(v);
                  }} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div data-testid="step-faction">
              <p className="wizard-lead">Choose the faction this army is built from.</p>
              {editions.length > 1 && (
                <div className="edition-picker" data-testid="edition-picker">
                  {editions.map((e) => (
                    <button key={e.id} type="button"
                      className={`step-tab${e.id === displayedEdition ? " active" : ""}`}
                      aria-pressed={e.id === displayedEdition}
                      onClick={() => setEdition(e.id)}>
                      <span className="step-lbl">{e.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="faction-grid">
                {registry
                  ? registry.filter((d) => d.edition === displayedEdition).map((d) => (
                      <button key={d.id}
                        className={`faction-card${d.id === activeDescriptorId ? " chosen" : ""}`}
                        aria-pressed={d.id === activeDescriptorId}
                        onClick={() => { if (d.id !== activeDescriptorId) onSelectFaction?.(d.id); }}>
                        <span className="fname">{d.name}</span>
                        <span className="fmeta">{d.source.kind === "bundled" ? "Bundled" : "Local"}</span>
                      </button>
                    ))
                  : (
                      <button className="faction-card chosen">
                        <span className="fname">{catalogue.name}</span>
                        <span className="fmeta">Loaded catalogue</span>
                      </button>
                    )}
              </div>
              {factionError && <p className="faction-error">{factionError}</p>}
            </div>
          )}

          {step === 2 && hasDetachmentStep && (
            <div className="det-layout" data-testid="step-detachment">
              <div className="det-list">
                {detachments.map((d) => (
                  <button key={d.id} className={`det-card${chosen === d.id ? " chosen" : ""}`}
                    aria-pressed={chosen === d.id} onClick={() => onSetDetachment(d.id)}>
                    <span className="det-check">{chosen === d.id ? "✓" : ""}</span>
                    <span className="det-name">{d.name}</span>
                  </button>
                ))}
              </div>
              <aside className="det-preview">
                <div className="ds-section-head">
                  {detachments.find((d) => d.id === chosen)?.name ?? "Enhancements"}
                </div>
                <div className="preview-body">
                  {preview.length === 0 && (
                    <div className="preview-empty">
                      {chosen ? "No enhancement preview." : "Select a detachment to preview its enhancements."}
                    </div>
                  )}
                  {preview.map((e) => (
                    <div key={e.id} className="enh-line">
                      <span className="enh-name">{e.name}</span>
                      <span className="enh-pts">{pointsCost(e)?.value ?? 0}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </div>

        <div className="wizard-foot">
          {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>← Back</button>}
          <span className="wizard-foot-spacer" />
          <button className="btn-primary" disabled={step === lastStep && !canFinish} onClick={next}>
            {step === lastStep ? "Start building" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
