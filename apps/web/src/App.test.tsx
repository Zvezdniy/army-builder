import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
});
