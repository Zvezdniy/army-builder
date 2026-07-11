import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("builder interactions", () => {
  it("adding a unit raises the live points total", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("points")).toHaveTextContent(/^0 \/ 2000/);
    // Captain (90 pts) in the palette
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^90 \/ 2000/);
    // it now appears in the roster panel
    expect(screen.getByTestId("roster-list")).toHaveTextContent("Captain");
  });

  it("selecting a weapon in a choose-1 group swaps rather than stacking", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    // Wargear is a max-1 group: Power Sword (5) / Power Axe (10) are toggles, not "+".
    await user.click(screen.getByRole("button", { name: /select Power Sword/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^95 \/ 2000/);
    // picking the axe REPLACES the sword — points reflect the swap, not a sum (would be 105).
    await user.click(screen.getByRole("button", { name: /select Power Axe/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^100 \/ 2000/);
    // the sword is now deselectable-again (offered), the axe is chosen (deselect offered)
    expect(screen.getByRole("button", { name: /select Power Sword/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deselect Power Axe/i })).toBeInTheDocument();
    // clicking the chosen axe again clears it back to no weapon
    await user.click(screen.getByRole("button", { name: /deselect Power Axe/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^90 \/ 2000/);
  });
});
