import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";

describe("UnitDetail statline wiring", () => {
  it("shows the selected unit's statline in the detail view", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Add unit/i }));
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    // Captain's Unit statline (mini fixture: M=6", T=4, SV=3+, W=5, LD=6+, OC=1)
    // and its invulnerable save are now rendered in the detail view.
    expect(screen.getByText('6"')).toBeInTheDocument();
    expect(screen.getByText("Invulnerable Save")).toBeInTheDocument();
  });

  it("marks a character as Warlord and shows the tag on its roster card", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Add unit/i }));
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    // Captain is an HQ character → the Make Warlord control is offered.
    await user.click(screen.getByRole("button", { name: "Make Warlord" }));
    expect(screen.getByRole("button", { name: "★ Warlord" })).toBeInTheDocument();
    // The tag appears as a chip on the unit's card in the roster list.
    expect(screen.getByText("Warlord", { selector: ".rl-chip-warlord" })).toBeInTheDocument();
  });

  it("does not crash for a unit without any profiles", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Add unit/i }));
    await user.click(screen.getByRole("button", { name: /add Assault Squad/i }));
    // Assault Squad has no profiles in the mini fixture: statline/datasheet null-guard,
    // the detail view still renders its editing controls without throwing.
    expect(screen.getByRole("button", { name: /back to list/i })).toBeInTheDocument();
  });
});
