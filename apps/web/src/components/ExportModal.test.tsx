import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, Roster } from "@muster/domain";
import { ExportModal } from "./ExportModal";

const unitProfile = [{ name: "Body", typeName: "Unit", characteristics: [] }];

const catalogue = {
  id: "cat", name: "Space Wolves", gameSystemId: "gs", revision: 1, forceConstraints: [],
  categoryNames: { "cat.epic": "Epic Hero" },
  entries: [
    { id: "e.logan", name: "Logan Grimnar", costs: [{ name: "points", value: 110 }],
      categories: ["cat.epic"], constraints: [], children: [], profiles: unitProfile },
  ],
} as unknown as IrCatalogue;

const roster = {
  id: "r", name: "My List", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "s1", entryId: "e.logan", count: 1, selections: [] }],
} as unknown as Roster;

function renderModal(onClose = () => {}) {
  return render(
    <ExportModal roster={roster} catalogue={catalogue} edition="10e" catalogueId="cat" onClose={onClose} />,
  );
}

describe("ExportModal", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("opens on the Detailed format with a live preview", () => {
    renderModal();
    const detailed = screen.getByRole("tab", { name: "Detailed" });
    expect(detailed).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("export-preview")).toHaveTextContent("My List (110 Points)");
    expect(screen.getByTestId("export-preview")).toHaveTextContent("Logan Grimnar (110 Points)");
  });

  it("switches to the Tournament format and shows the WTC summary block", async () => {
    renderModal();
    await userEvent.click(screen.getByRole("tab", { name: /Tournament/ }));
    const preview = screen.getByTestId("export-preview");
    expect(preview).toHaveTextContent("+ FACTION: Space Wolves");
    expect(preview).toHaveTextContent("+ WARLORD: Logan Grimnar");
    expect(preview).toHaveTextContent("+ NUMBER OF UNITS: 1");
  });

  it("switches to the File (.json) format and shows the re-importable envelope", async () => {
    renderModal();
    await userEvent.click(screen.getByRole("tab", { name: /File/ }));
    expect(screen.getByTestId("export-preview")).toHaveTextContent("muster-roster/v1");
  });

  it("copies the current preview text to the clipboard", async () => {
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: /Copy to clipboard/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Logan Grimnar (110 Points)");
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("closes on the ✕ button", async () => {
    const onClose = vi.fn();
    renderModal(onClose);
    await userEvent.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
