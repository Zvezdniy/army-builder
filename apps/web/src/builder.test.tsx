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

  it("an added option renders nested under its unit and can be removed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    // Captain exposes wargear options; adding one renders a nested node with its
    // OWN controls — a per-option "remove" button (only real selections produce it,
    // never the palette/add-option buttons).
    await user.click(screen.getByRole("button", { name: /add option Power Sword/i }));
    expect(screen.getByRole("button", { name: /remove e\.captain\.sword/i })).toBeInTheDocument();
    // that per-option remove drops just the option; the Captain (and its remove) stays.
    await user.click(screen.getByRole("button", { name: /remove e\.captain\.sword/i }));
    expect(screen.queryByRole("button", { name: /remove e\.captain\.sword/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove e\.captain$/i })).toBeInTheDocument();
  });
});
