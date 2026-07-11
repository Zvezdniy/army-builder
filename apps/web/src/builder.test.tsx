import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("builder interactions", () => {
  it("adding a unit raises the live points total", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("points")).toHaveTextContent(/^0 \/ 2000/);
    // Captain (90 pts) — added via the unit picker
    await user.click(screen.getByRole("button", { name: /добавить юнит/i }));
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^90 \/ 2000/);
    // it now appears in the roster panel
    expect(screen.getByTestId("roster-list")).toHaveTextContent("Captain");
  });

  it("selecting a weapon in a choose-1 group swaps rather than stacking", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /добавить юнит/i }));
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

  it("derives controls from constraints: required radio, and a bounded stepper", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /добавить юнит/i }));
    await user.click(screen.getByRole("button", { name: /add Assault Squad/i }));
    // prepopulated on add: Chainsword (group default, +5) and Marine (min 1, +18) → 80+5+18 = 103
    expect(screen.getByTestId("points")).toHaveTextContent(/^103 \/ 2000/);

    // Special Weapon is a required (min 1) choose-1 group; Chainsword is already chosen by default.
    expect(screen.getByRole("button", { name: /deselect Chainsword/i })).toBeInTheDocument();
    // required → clicking the sole chosen member does NOT empty it (stays 103, still chosen)
    await user.click(screen.getByRole("button", { name: /deselect Chainsword/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^103 \/ 2000/);
    // but swapping to the other member works: 80 + 15 + 18 = 113
    await user.click(screen.getByRole("button", { name: /select Plasma Pistol/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^113 \/ 2000/);

    // Marine is a countable option (min 1, max 5) → a −/+ stepper; one is already seeded.
    await user.click(screen.getByRole("button", { name: /increase e\.assault\.marine/i }));
    expect(screen.getByTestId("points")).toHaveTextContent(/^131 \/ 2000/); // 113 + 18
  });
});
