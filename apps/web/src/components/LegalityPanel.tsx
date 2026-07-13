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

/** Matched-play legality readout: overall verdict, a points meter, a positive
 *  pass/fail checklist of army-level rules, and the issue list split into
 *  army-wide problems and clickable unit problems. Pure view over evaluate(). */
export function LegalityPanel({ result, unitNameOf, onEditPoints, onFocusUnit }: LegalityPanelProps) {
  const { valid, totalPoints, pointsLimit, checks, issues } = result;
  const remaining = pointsLimit - totalPoints;
  const over = totalPoints > pointsLimit;
  const fillPct = pointsLimit > 0 ? Math.min(100, (totalPoints / pointsLimit) * 100) : 0;

  const armyIssues = issues.filter((i) => i.selectionId === undefined);
  const unitIssues = issues.filter((i) => i.selectionId !== undefined);

  return (
    <section className="legality" aria-label="Army legality">
      <div className="legality-head">
        <span role="status" data-testid="verdict" className={valid ? "verdict legal" : "verdict illegal"}>
          {valid ? "LEGAL" : "ILLEGAL"}
        </span>
        <div className="pts">
          <div className={over ? "pts-bar over" : "pts-bar"}>
            <div className="pts-fill" style={{ width: `${fillPct}%` }} />
          </div>
          <span data-testid="points" className="pts-label">
            {totalPoints} / {pointsLimit} pts
            <span className={over ? "pts-remain over" : "pts-remain"}>
              {over ? ` · over by ${-remaining}` : ` · ${remaining} left`}
            </span>
          </span>
        </div>
        <button data-testid="edit-points" className="pts-edit" onClick={onEditPoints}>
          Edit
        </button>
      </div>

      {checks.length > 0 && (
        <ul data-testid="army-checks" className="checklist">
          {checks.map((c) => {
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

      {(armyIssues.length > 0 || unitIssues.length > 0) && (
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
