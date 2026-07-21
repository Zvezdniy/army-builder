import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseLibrary } from "@muster/roster";
import { App } from "./App";

describe("App", () => {
  it("renders the points bar from the real engine", () => {
    render(<App />);
    // Fresh roster on mini40k: 0 points against a default limit.
    expect(screen.getByTestId("points")).toHaveTextContent(/0\s*\/\s*2000/);
  });

  it("renders the legality panel with a verdict", () => {
    render(<App />);
    expect(screen.getByTestId("verdict")).toBeTruthy();
  });

  it("shows the setup bar and does not auto-open the wizard on the detachment-less mini fixture", () => {
    render(<App />);
    expect(screen.getByTestId("setup-bar")).toBeTruthy();
    // mini40k models no detachment → no first-run wizard.
    expect(screen.queryByRole("dialog", { name: "army setup" })).toBeNull();
  });

  it("opens the faction step showing at least the bundled faction", () => {
    render(<App />);
    // Open the wizard at the faction step via the setup bar faction chip.
    fireEvent.click(screen.getByText("Faction"));
    // With no public/catalogues.json in jsdom, the registry degrades to bundled-only.
    const step = screen.getByTestId("step-faction");
    expect(within(step).getByText("Mini 40k")).toBeTruthy();
  });

  it("persists the active roster and restores it on remount", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    // Add a unit so the roster is non-empty — same picker flow as builder.test.tsx.
    await user.click(screen.getByRole("button", { name: /Add unit/i }));
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^90 \/ 2000/);

    await waitFor(() => expect(localStorage.getItem("muster:library:v1")).toBeTruthy());
    const saved = parseLibrary(JSON.parse(localStorage.getItem("muster:library:v1")!));
    expect(saved.entries.length).toBeGreaterThan(0);
    expect(saved.entries[0]?.roster.selections.length).toBeGreaterThan(0);

    unmount();
    render(<App />);
    // The restored roster carries the Captain over — points reflect it immediately,
    // no re-adding needed.
    await waitFor(() => expect(screen.getByTestId("points")).toHaveTextContent(/^90 \/ 2000/));
    expect(screen.getByTestId("roster-list")).toHaveTextContent("Captain");
  });
});
