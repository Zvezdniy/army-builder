import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { Datasheet } from "./Datasheet";

const cat = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1,
  ruleTexts: { "Precision": "Attacks can be allocated to a Character." },
  entries: [
    { id: "e.hero", name: "Hero", costs: [], categories: ["Infantry"], constraints: [], children: [
        { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [],
          profiles: [{ name: "Sword", typeName: "Melee Weapons", keywords: ["Precision"],
            characteristics: [{ name: "A", value: "5" }, { name: "S", value: "5" }] }] },
      ], groups: [],
      profiles: [{ name: "Hero", typeName: "Unit",
        characteristics: [{ name: "M", value: '6"' }, { name: "T", value: "4" }] }] },
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count: 1, selections: children,
});

describe("Datasheet", () => {
  it("renders the unit statline characteristics", () => {
    render(<Datasheet catalogue={cat} selection={sel("e.hero")} />);
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText('6"')).toBeInTheDocument();
  });

  it("shows a weapon row only when the weapon is selected", () => {
    const { rerender } = render(<Datasheet catalogue={cat} selection={sel("e.hero")} />);
    expect(screen.queryByText("Sword")).not.toBeInTheDocument();
    rerender(<Datasheet catalogue={cat} selection={sel("e.hero", [sel("e.sword")])} />);
    expect(screen.getByText("Sword")).toBeInTheDocument();
  });

  it("opens a rule popup when a weapon keyword is clicked", async () => {
    render(<Datasheet catalogue={cat} selection={sel("e.hero", [sel("e.sword")])} />);
    expect(screen.queryByText(/allocated to a Character/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Precision rule/i }));
    expect(screen.getByText(/allocated to a Character/i)).toBeInTheDocument();
  });
});
