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
});
