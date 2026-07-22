import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LegalityPanel } from "./LegalityPanel";
import type { ValidationResult } from "@muster/domain";

function baseResult(over: Partial<ValidationResult> = {}): ValidationResult {
  return {
    valid: true,
    totalPoints: 90,
    pointsLimit: 2000,
    issues: [],
    dismissed: [],
    hasHouseRules: false,
    checks: [{ id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true }],
    ...over,
  };
}

const noop = () => {};

/** The panel is collapsed by default — reveal the checklist + issue detail. */
function expand() {
  fireEvent.click(screen.getByTestId("legality-toggle"));
}

describe("LegalityPanel", () => {
  it("shows a LEGAL verdict when valid", () => {
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/legal/i);
  });

  it("shows an ILLEGAL verdict when invalid", () => {
    render(<LegalityPanel result={baseResult({ valid: false })} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/illegal/i);
  });

  it("points element text starts with total / limit", () => {
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.getByTestId("points").textContent ?? "").toMatch(/^90 \/ 2000/);
  });

  it("shows points remaining under the limit", () => {
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.getByTestId("points")).toHaveTextContent(/1910 left/);
  });

  it("shows over-by when past the limit", () => {
    render(
      <LegalityPanel
        result={baseResult({ totalPoints: 2100, valid: false, checks: [{ id: "points", kind: "points", label: "Points", actual: 2100, limit: 2000, satisfied: false }] })}
        unitNameOf={() => undefined}
        onEditPoints={noop}
        onFocusUnit={noop}
      />,
    );
    expect(screen.getByTestId("points")).toHaveTextContent(/over by 100/);
  });

  it("hides the checklist until the summary is expanded", () => {
    const result = baseResult({
      valid: false,
      checks: [
        { id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true },
        { id: "f1", kind: "force", label: 'At least 1 category "Battleline"', actual: 0, limit: 1, satisfied: false, constraintType: "min" },
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.queryByTestId("army-checks")).toBeNull();
    expand();
    expect(screen.getByTestId("army-checks")).toHaveTextContent("Battleline");
  });

  it("summarises the number of problems in the collapsed line", () => {
    const result = baseResult({
      valid: false,
      issues: [
        { severity: "error", code: "points.over", message: "Over points limit" },
        { severity: "error", code: "constraint.min", message: "Not enough", selectionId: "s1", entryId: "e1" },
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => "Captain"} onEditPoints={noop} onFocusUnit={noop} />);
    // Visible without expanding: two issues → "2 problems".
    expect(screen.getByTestId("legality-toggle")).toHaveTextContent(/2 problems/);
  });

  it("renders a check row per check with satisfied semantics", () => {
    const result = baseResult({
      checks: [
        { id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true },
        { id: "f1", kind: "force", label: 'At least 1 category "Battleline"', actual: 0, limit: 1, satisfied: false, constraintType: "min" },
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expand();
    const checks = screen.getByTestId("army-checks");
    expect(checks).toHaveTextContent("Battleline");
    expect(checks.querySelectorAll("[data-satisfied='false']").length).toBe(1);
    expect(checks.querySelectorAll("[data-satisfied='true']").length).toBe(1);
  });

  it("collapses duplicate identical checks into a single row", () => {
    const dup = { kind: "force" as const, label: 'At least 1 category "Character"', actual: 2, limit: 1, satisfied: true, constraintType: "min" as const };
    const result = baseResult({
      checks: [
        { id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true },
        { id: "c1", ...dup },
        { id: "c2", ...dup }, // same display as c1 → deduped away
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expand();
    const rows = screen.getByTestId("army-checks").querySelectorAll("li");
    // Points + one Character row (the duplicate is dropped) = 2 rows.
    expect(rows.length).toBe(2);
  });

  it("renders a house-ruled failing check distinctly (not a hard failure)", () => {
    const result = baseResult({
      checks: [
        { id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true },
        { id: "f1", kind: "force", label: 'At least 1 category "HQ"', actual: 0, limit: 1, satisfied: false, constraintType: "min", dismissed: true },
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expand();
    const checks = screen.getByTestId("army-checks");
    const ruled = checks.querySelector("[data-state='ruled']");
    expect(ruled).not.toBeNull();
    expect(ruled).toHaveTextContent(/house-ruled/);
    // A house-ruled check must not read as a hard failure.
    expect(checks.querySelectorAll("[data-state='bad']").length).toBe(0);
  });

  it("does not render the checklist when there are no checks", () => {
    render(<LegalityPanel result={baseResult({ checks: [] })} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expand();
    expect(screen.queryByTestId("army-checks")).toBeNull();
  });

  it("calls onFocusUnit when a unit issue is clicked, showing the unit name", () => {
    const onFocusUnit = vi.fn();
    const result = baseResult({
      valid: false,
      issues: [{ severity: "error", code: "constraint.min", message: "Not enough", selectionId: "s1", entryId: "e1" }],
    });
    render(<LegalityPanel result={result} unitNameOf={() => "Captain"} onEditPoints={noop} onFocusUnit={onFocusUnit} />);
    expand();
    fireEvent.click(screen.getByText(/Captain/));
    expect(onFocusUnit).toHaveBeenCalledWith("s1");
  });

  it("renders army-level issues without a unit link", () => {
    const result = baseResult({
      valid: false,
      issues: [{ severity: "error", code: "points.over", message: "Over points limit" }],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expand();
    expect(screen.getByText(/Over points limit/)).toBeTruthy();
  });

  it("calls onEditPoints when Edit is clicked", () => {
    const onEditPoints = vi.fn();
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={onEditPoints} onFocusUnit={noop} />);
    fireEvent.click(screen.getByTestId("edit-points"));
    expect(onEditPoints).toHaveBeenCalled();
  });
});
