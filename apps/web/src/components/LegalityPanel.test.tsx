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

  it("renders a check row per check with satisfied semantics", () => {
    const result = baseResult({
      checks: [
        { id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true },
        { id: "f1", kind: "force", label: 'At least 1 category "Battleline"', actual: 0, limit: 1, satisfied: false, constraintType: "min" },
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    const checks = screen.getByTestId("army-checks");
    expect(checks).toHaveTextContent("Battleline");
    expect(checks.querySelectorAll("[data-satisfied='false']").length).toBe(1);
    expect(checks.querySelectorAll("[data-satisfied='true']").length).toBe(1);
  });

  it("does not render the checklist when there are no checks", () => {
    render(<LegalityPanel result={baseResult({ checks: [] })} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.queryByTestId("army-checks")).toBeNull();
  });

  it("calls onFocusUnit when a unit issue is clicked, showing the unit name", () => {
    const onFocusUnit = vi.fn();
    const result = baseResult({
      valid: false,
      issues: [{ severity: "error", code: "constraint.min", message: "Not enough", selectionId: "s1", entryId: "e1" }],
    });
    render(<LegalityPanel result={result} unitNameOf={() => "Captain"} onEditPoints={noop} onFocusUnit={onFocusUnit} />);
    fireEvent.click(screen.getByText(/Captain/));
    expect(onFocusUnit).toHaveBeenCalledWith("s1");
  });

  it("renders army-level issues without a unit link", () => {
    const result = baseResult({
      valid: false,
      issues: [{ severity: "error", code: "points.over", message: "Over points limit" }],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={noop} onFocusUnit={noop} />);
    expect(screen.getByText(/Over points limit/)).toBeTruthy();
  });

  it("calls onEditPoints when Edit is clicked", () => {
    const onEditPoints = vi.fn();
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={onEditPoints} onFocusUnit={noop} />);
    fireEvent.click(screen.getByTestId("edit-points"));
    expect(onEditPoints).toHaveBeenCalled();
  });
});
