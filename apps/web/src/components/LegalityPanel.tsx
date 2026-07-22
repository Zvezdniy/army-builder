import { useState } from "react";
import type { ValidationResult } from "@muster/domain";

export type LegalityPanelProps = {
  result: ValidationResult;
  /** Resolve the display name of the top-level unit owning a selection id. */
  unitNameOf: (selectionId: string) => string | undefined;
  /** Open the setup wizard on its Points step. */
  onEditPoints: () => void;
  /** Focus the unit owning a selection id (e.g. from a unit-level issue). */
  onFocusUnit: (selectionId: string) => void;
};

/** Matched-play legality readout. Collapsed by default to a single summary line —
 *  verdict + points meter + a problem count — so the panel stays small; the full
 *  pass/fail checklist and the issue list reveal on click. Pure view over
 *  evaluate(). */
export function LegalityPanel({ result, unitNameOf, onEditPoints, onFocusUnit }: LegalityPanelProps) {
  const [open, setOpen] = useState(false);
  const { valid, totalPoints, pointsLimit, checks, issues } = result;
  const remaining = pointsLimit - totalPoints;
  const over = totalPoints > pointsLimit;
  const fillPct = pointsLimit > 0 ? Math.min(100, (totalPoints / pointsLimit) * 100) : 0;

  // Some catalogues emit the same army rule twice (e.g. a detachment and a force
  // both requiring a Character), which showed as a duplicate row. Drop rows that
  // are byte-identical in what they display — identical rows carry no extra info.
  const seen = new Set<string>();
  const dedupedChecks = checks.filter((c) => {
    const key = `${c.label}|${c.actual}|${c.limit}|${c.satisfied}|${c.dismissed ?? false}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const armyIssues = issues.filter((i) => i.selectionId === undefined);
  const unitIssues = issues.filter((i) => i.selectionId !== undefined);

  // Everything wrong: hard-failing checks (not satisfied, not house-ruled) plus
  // every issue. Drives the collapsed-line summary.
  const failing = dedupedChecks.filter((c) => !c.satisfied && c.dismissed !== true).length;
  const problems = failing + issues.length;

  return (
    <section className="legality" aria-label="Army legality">
      <div className="legality-head">
        {/* The whole summary line is the disclosure toggle; Edit stays a separate
            button (buttons can't nest). Meter/label use spans so the toggle holds
            only phrasing content. */}
        <button
          type="button"
          className="legality-toggle"
          data-testid="legality-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="legality-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span role="status" data-testid="verdict" className={valid ? "verdict legal" : "verdict illegal"}>
            {valid ? "LEGAL" : "ILLEGAL"}
          </span>
          <span className="pts">
            <span className={over ? "pts-bar over" : "pts-bar"}>
              <span className="pts-fill" style={{ width: `${fillPct}%` }} />
            </span>
            <span data-testid="points" className="pts-label">
              {totalPoints} / {pointsLimit} pts
              <span className={over ? "pts-remain over" : "pts-remain"}>
                {over ? ` · over by ${-remaining}` : ` · ${remaining} left`}
              </span>
            </span>
          </span>
          {problems > 0 && (
            <span className="legality-problems">· {problems} problem{problems === 1 ? "" : "s"}</span>
          )}
        </button>
        <button data-testid="edit-points" className="pts-edit" onClick={onEditPoints}>
          Edit
        </button>
      </div>

      {open && dedupedChecks.length > 0 && (
        <ul data-testid="army-checks" className="checklist">
          {dedupedChecks.map((c) => {
            // Three states: satisfied (pass), house-ruled (fails on paper but
            // dismissed by an override → not a hard failure), and hard failure.
            const houseRuled = !c.satisfied && c.dismissed === true;
            const state = c.satisfied ? "ok" : houseRuled ? "ruled" : "bad";
            const status = c.satisfied ? "passed" : houseRuled ? "house-ruled" : "failed";
            return (
              <li key={c.id} data-satisfied={String(c.satisfied)} data-state={state} className={`check ${state}`}>
                <span className="check-glyph" aria-hidden="true">
                  {c.satisfied ? "✓" : houseRuled ? "≈" : "✗"}
                </span>
                <span className="vh">{status}: </span>
                <span className="check-label">
                  {c.label}
                  {houseRuled && <span className="check-note"> · house-ruled</span>}
                </span>
                <span className="tabnum">
                  {c.actual} / {c.limit}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {open && (armyIssues.length > 0 || unitIssues.length > 0) && (
        <ul className="issue-list">
          {armyIssues.map((i, idx) => (
            <li key={`a${idx}`} className={`issue ${i.severity}`}>
              {i.message}
            </li>
          ))}
          {unitIssues.map((i, idx) => (
            <li key={`u${idx}`} className={`issue ${i.severity}`}>
              <button className="issue-link" onClick={() => onFocusUnit(i.selectionId as string)}>
                {unitNameOf(i.selectionId as string) ?? "Unit"}: {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
