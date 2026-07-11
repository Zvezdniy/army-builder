import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the points bar from the real engine", () => {
    render(<App />);
    // Fresh roster on mini40k: 0 points against a default limit.
    expect(screen.getByTestId("points")).toHaveTextContent(/0\s*\/\s*2000/);
  });
});
