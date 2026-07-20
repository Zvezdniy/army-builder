import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";
import { Datasheet, UnitStatline } from "./Datasheet";

const cat = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1,
  ruleTexts: { "Precision": "Attacks can be allocated to a Character." },
  entries: [
    { id: "e.hero", name: "Hero", costs: [], categories: ["Infantry"], constraints: [], children: [
        { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [],
          profiles: [{ name: "Sword", typeName: "Melee Weapons", keywords: ["Precision"],
            characteristics: [{ name: "A", value: "5" }, { name: "S", value: "5" }] }] },
      ], groups: [],
      profiles: [
        { name: "Hero", typeName: "Unit",
          characteristics: [{ name: "M", value: '6"' }, { name: "T", value: "4" }] },
        { name: "Invulnerable Save", typeName: "Invulnerable Save",
          characteristics: [{ name: "SV", value: "4+" }] },
        { name: "Leader", typeName: "Abilities", group: "Core", characteristics: [] },
        { name: "Rites of Battle", typeName: "Abilities",
          characteristics: [{ name: "Description", value: "Re-roll one Hit roll." }] },
        { name: "Damaged: 1-2 Wounds", typeName: "Damaged",
          characteristics: [{ name: "Description", value: "Subtract 1 from Hit rolls." }] },
      ] },
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count: 1, selections: children,
});

// effectiveDatasheet() needs the WHOLE roster (a modifier's conditions can
// reference force/roster scope), not just the unit subtree — wrap a top-level
// selection into a minimal roster the way apps/web's real roster shapes it.
const rosterOf = (...selections: RosterSelection[]): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1,
  pointsLimit: 2000, selections,
});

describe("Datasheet", () => {
  it("renders the unit statline characteristics and the invulnerable-save chip", () => {
    const hero = sel("e.hero");
    render(<UnitStatline catalogue={cat} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText('6"')).toBeInTheDocument();
    expect(screen.getByText("4+")).toBeInTheDocument();
    expect(screen.getByText("Invulnerable Save")).toBeInTheDocument();
  });

  it("groups Core abilities into one line and renders named abilities in full", () => {
    const hero = sel("e.hero");
    render(<Datasheet catalogue={cat} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText("CORE:")).toBeInTheDocument();
    expect(screen.getByText(/Leader/)).toBeInTheDocument();
    expect(screen.getByText(/Rites of Battle\./)).toBeInTheDocument();
    expect(screen.getByText(/Re-roll one Hit roll/)).toBeInTheDocument();
  });

  it("renders a special rule section (Damaged) with its description", () => {
    const hero = sel("e.hero");
    render(<Datasheet catalogue={cat} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText("Damaged")).toBeInTheDocument();
    expect(screen.getByText(/Subtract 1 from Hit rolls/)).toBeInTheDocument();
  });

  it("summarizes the selected wargear as a loadout line", () => {
    const hero = sel("e.hero", [sel("e.sword")]);
    render(<Datasheet catalogue={cat} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText(/equipped with: Sword/)).toBeInTheDocument();
  });

  it("shows a weapon row only when the weapon is selected", () => {
    const bare = sel("e.hero");
    const { rerender } = render(<Datasheet catalogue={cat} roster={rosterOf(bare)} selection={bare} />);
    expect(screen.queryByText("Sword")).not.toBeInTheDocument();
    const armed = sel("e.hero", [sel("e.sword")]);
    rerender(<Datasheet catalogue={cat} roster={rosterOf(armed)} selection={armed} />);
    expect(screen.getByText("Sword")).toBeInTheDocument();
  });

  it("opens a rule popup when a weapon keyword is clicked", async () => {
    const hero = sel("e.hero", [sel("e.sword")]);
    render(<Datasheet catalogue={cat} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.queryByText(/allocated to a Character/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Precision rule/i }));
    expect(screen.getByText(/allocated to a Character/i)).toBeInTheDocument();
  });
});

// Real BSData encodes the invuln as an "Abilities" profile named "Invulnerable
// Save", value in Description — not a dedicated typeName. These cover that shape.
function realInvulnCat(abilityName: string, description: string): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [
      { id: "e.hero", name: "Hero", costs: [], categories: [], constraints: [], children: [], groups: [],
        profiles: [
          { name: "Hero", typeName: "Unit",
            characteristics: [{ name: "M", value: '6"' }, { name: "T", value: "4" }, { name: "SV", value: "3+" }] },
          { name: abilityName, typeName: "Abilities",
            characteristics: [{ name: "Description", value: description }] },
          { name: "Rites of Battle", typeName: "Abilities",
            characteristics: [{ name: "Description", value: "Re-roll one Hit roll." }] },
        ] },
    ],
  } as unknown as IrCatalogue;
}

describe("Datasheet invulnerable save from real (Abilities-encoded) data", () => {
  it("shows the chip for a bare 'N+' invuln ability and de-dups it from Abilities", () => {
    const c = realInvulnCat("Invulnerable Save", "6+");
    const hero = sel("e.hero");
    const { unmount } = render(<UnitStatline catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText("6+")).toBeInTheDocument(); // chip value
    expect(screen.getByText("Invulnerable Save")).toBeInTheDocument(); // chip label
    unmount();
    // In the datasheet body the bare invuln line is dropped (chip already shows it),
    // but other abilities remain.
    render(<Datasheet catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText(/Rites of Battle/)).toBeInTheDocument();
    expect(screen.queryByText(/Invulnerable Save\./)).not.toBeInTheDocument();
  });

  it("parses the save out of a qualified sentence and keeps the ability line", () => {
    const c = realInvulnCat("Invulnerable Save", "This model has a 5+ invulnerable save against ranged attacks.");
    const hero = sel("e.hero");
    render(<UnitStatline catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText("5+")).toBeInTheDocument(); // parsed from the sentence
    // The qualifier matters, so the full ability stays in the datasheet body.
    render(<Datasheet catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText(/against ranged attacks/)).toBeInTheDocument();
  });

  it("handles a footnoted '4+\\n* …' invuln: chip shows 4+, footnote kept in Abilities", () => {
    const c = realInvulnCat("Invulnerable Save*", "4+\n* This model has a 4+ invulnerable save against melee attacks.");
    const hero = sel("e.hero");
    render(<UnitStatline catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText("4+")).toBeInTheDocument();
    render(<Datasheet catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText(/against melee attacks/)).toBeInTheDocument(); // not de-duped (qualified)
  });

  it("shows no invuln chip when the unit has none", () => {
    const c = realInvulnCat("Feel No Pain", "5+"); // an unrelated ability that happens to hold "5+"
    const hero = sel("e.hero");
    render(<UnitStatline catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.queryByText("Invulnerable Save")).not.toBeInTheDocument();
  });

  it("shows no chip when a matching ability has no parseable save, keeping the line", () => {
    // Name matches but the Description carries no "N+" → no chip (never a broken one),
    // and the ability is NOT de-duped from Abilities (nothing replaced it).
    const c = realInvulnCat("Invulnerable Save", "This model cannot be targeted by ranged attacks.");
    const hero = sel("e.hero");
    const { unmount } = render(<UnitStatline catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.queryByText("Invulnerable Save")).not.toBeInTheDocument(); // no chip label
    unmount();
    render(<Datasheet catalogue={c} roster={rosterOf(hero)} selection={hero} />);
    expect(screen.getByText(/cannot be targeted/)).toBeInTheDocument(); // line preserved
  });
});
