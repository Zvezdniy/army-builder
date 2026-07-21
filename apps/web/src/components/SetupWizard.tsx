import { useState } from "react";
import type { IrCatalogue, IrEntry, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments, catalogueEntry } from "@muster/roster";
import {
  pointsCost, correctedConstraintValue, DETACHMENT_POINTS,
  buildState, resolveCosts, effectiveCostOfType,
} from "@muster/engine-eval";
import type { CatalogueDescriptor } from "../registry/catalogueRegistry";

const POINTS_PRESETS = [1000, 1500, 2000];

// A catalogue that never prices detachments in DETACHMENT_POINTS (10e) simply never
// triggers the meter below — no edition check needed.
function detachmentPointsCost(entry: IrEntry): number {
  return entry.costs.find((c) => c.name === DETACHMENT_POINTS)?.value ?? 0;
}

/** The enhancements a detachment unlocks: the union of every group named
 *  "<name> Enhancements" found anywhere in the catalogue tree (best-effort by group
 *  name — informational preview only). An `entryLink` is a PLACEMENT, not a pointer —
 *  it may declare its own children that apply only to that placement — so the same
 *  named group can legitimately recur at many placements with different members.
 *  Taking only the first match would silently hide members that only appear at a
 *  later placement, so this walks the WHOLE tree and unions every match, deduping
 *  by entry id in first-encounter order. */
function enhancementsFor(catalogue: IrCatalogue, detachmentName: string): IrEntry[] {
  const wanted = `${detachmentName} Enhancements`;
  const stack: IrEntry[] = [...catalogue.entries];
  const seen = new Set<string>();
  const ids: string[] = [];
  while (stack.length > 0) {
    const e = stack.pop() as IrEntry;
    for (const group of e.groups ?? []) {
      if (group.name !== wanted) continue;
      for (const id of group.memberEntryIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    stack.push(...e.children);
  }
  return ids
    .map((id) => catalogueEntry(catalogue, id))
    .filter((e): e is IrEntry => e !== undefined);
}

const STEPS = ["Points", "Faction", "Detachment"] as const;

/** First-run army setup: points → faction (placeholder) → detachment. Controlled —
 *  reads live roster/catalogue, applies each choice immediately via callbacks. */
export function SetupWizard({
  catalogue, roster, initialStep = 0, onSetPoints, onToggleDetachment, onClose,
  registry, activeDescriptorId, onSelectFaction, factionError,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  initialStep?: number;
  onSetPoints: (n: number) => void;
  onToggleDetachment: (entryId: string) => void;
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
  const chosenIds = selectedDetachments(roster, catalogue);
  const [customPts, setCustomPts] = useState("");

  // Mini 40k (the bundled fixture) is the app's guaranteed-available fallback and its
  // initial active catalogue, but it should not be offered as a faction to build once
  // real catalogues are loaded. Hide the bundled descriptor from the picker WHENEVER a
  // real (manifest) faction exists; keep it when it is the only thing there (manifest
  // fetch failed), so the picker is never empty. Both the edition tabs and the faction
  // grid derive from this filtered view.
  const shownRegistry = registry?.some((d) => d.source.kind !== "bundled")
    ? registry.filter((d) => d.source.kind !== "bundled")
    : registry;

  // Edition list derived from the shown registry, first-appearance order preserved.
  const editions = shownRegistry
    ? shownRegistry.reduce<{ id: string; name: string }[]>((acc, d) => (
        acc.some((e) => e.id === d.edition) ? acc : [...acc, { id: d.edition, name: d.editionName }]
      ), [])
    : [];
  const activeEdition = shownRegistry?.find((d) => d.id === activeDescriptorId)?.edition ?? editions[0]?.id;
  // `undefined` means "the user hasn't picked an edition locally yet" — the displayed
  // edition then tracks `activeEdition` for free. Once the user clicks a segment this
  // holds their explicit choice instead. A useEffect to resync on `activeEdition` changes
  // would fight that explicit choice (e.g. right after `onSelectFaction` updates the active
  // descriptor), so we deliberately don't add one — the derived fallback covers it.
  const [edition, setEdition] = useState<string | undefined>(undefined);
  const displayedEdition = edition ?? activeEdition;

  const canFinish = !hasDetachmentStep || chosenIds.length > 0;
  const next = () => (step < lastStep ? setStep(step + 1) : onClose());
  // One preview section per chosen detachment (§ enhancements preview follows the
  // selected set, not just the first).
  const previews = chosenIds
    .map((id) => detachments.find((d) => d.id === id))
    .filter((d): d is IrEntry => d !== undefined)
    .map((d) => ({ detachment: d, enhancements: enhancementsFor(catalogue, d.name) }));

  // The DP budget meter renders only when the catalogue actually PRICES detachments
  // (a "Detachment Points" cost on at least one detachment entry) — never on an
  // edition check. A 10e catalogue prices none, so this is always false there and the
  // meter simply doesn't render.
  const pricesDetachments = detachments.some((d) => d.costs.some((c) => c.name === DETACHMENT_POINTS));
  // "Used" is summed through the SAME effective-cost path the engine's own legality
  // check uses (buildState → resolveCosts → effectiveCostOfType), so a conditional
  // cost modifier on a detachment (e.g. Bastion Task Force's base-2-but-`set`-3) is
  // never silently under-counted here while the engine correctly counts it — the
  // meter must never disagree with the engine. Each chosen detachment's entryId is
  // unique catalogue-wide, so matching state.all by entry id finds its own roster node.
  const dpUsed = (() => {
    if (!pricesDetachments || chosenIds.length === 0) return 0;
    const state = buildState(roster, catalogue);
    const { costOf } = resolveCosts(state);
    return chosenIds.reduce((sum, id) => {
      const node = state.all.find((n) => n.entry.id === id);
      return sum + (node ? effectiveCostOfType(node, DETACHMENT_POINTS, state, costOf) : 0);
    }, 0);
  })();
  // Cap comes straight from the catalogue's own force constraint on Detachment
  // Points, through engine-eval's correction (the upstream-data floor of 3) — never
  // hardcoded here, so the meter and the engine's own legality check always agree.
  const dpConstraint = catalogue.forceConstraints.find(
    (c) => c.targetType === "force" && c.type === "max" && c.field === DETACHMENT_POINTS,
  );
  const dpCap = dpConstraint ? correctedConstraintValue(dpConstraint) : undefined;
  const dpOverBudget = dpCap !== undefined && dpUsed > dpCap;

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
                {shownRegistry
                  ? shownRegistry.filter((d) => d.edition === displayedEdition).map((d) => (
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
            <div data-testid="step-detachment">
              {pricesDetachments && (
                <div className={`dp-meter${dpOverBudget ? " over" : ""}`} data-testid="dp-meter">
                  <span className="dp-meter-label">Detachment Points</span>
                  <span className="dp-meter-value">
                    {dpUsed}{dpCap !== undefined ? ` / ${dpCap}` : ""}
                  </span>
                  {/* Over budget is shown, never blocked — legality stays the engine's job. */}
                  {dpOverBudget && <span className="dp-meter-warn">Over budget</span>}
                </div>
              )}
              <div className="det-layout">
                <div className="det-list">
                  {detachments.map((d) => {
                    const isChosen = chosenIds.includes(d.id);
                    const dp = detachmentPointsCost(d);
                    return (
                      <button key={d.id} className={`det-card${isChosen ? " chosen" : ""}`}
                        aria-pressed={isChosen} onClick={() => onToggleDetachment(d.id)}>
                        <span className="det-check">{isChosen ? "✓" : ""}</span>
                        <span className="det-name">{d.name}</span>
                        {pricesDetachments && <span className="det-dp">{dp} DP</span>}
                      </button>
                    );
                  })}
                </div>
                <aside className="det-preview">
                  {previews.length === 0 && (
                    <>
                      <div className="ds-section-head">Enhancements</div>
                      <div className="preview-body">
                        <div className="preview-empty">Select a detachment to preview its enhancements.</div>
                      </div>
                    </>
                  )}
                  {previews.map(({ detachment, enhancements }) => {
                    const rules = (detachment.ruleNames ?? []).map((name) => ({
                      name, text: catalogue.ruleTexts?.[name],
                    }));
                    return (
                      <div key={detachment.id} className="det-preview-section">
                        <div className="ds-section-head">{detachment.name}</div>
                        <div className="preview-body">
                          {rules.length > 0 && (
                            <div className="det-rules">
                              {rules.map((r) => (
                                <div key={r.name} className="det-rule">
                                  <div className="det-rule-name">{r.name}</div>
                                  {r.text && <p className="det-rule-text">{r.text}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="preview-subhead">Enhancements</div>
                          {enhancements.length === 0 && (
                            <div className="preview-empty">No enhancement preview.</div>
                          )}
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
                </aside>
              </div>
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
