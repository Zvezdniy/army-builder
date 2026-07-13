import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
