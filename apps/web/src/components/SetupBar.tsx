import type { IrCatalogue, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachment } from "@muster/roster";

/** Persistent, always-editable summary of the army setup: points · faction ·
 *  detachment. Each chip reopens the wizard on its step. The detachment chip is
 *  omitted when the catalogue models no detachment. */
export function SetupBar({
  catalogue, roster, onEdit,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  onEdit: (step: number) => void;
}) {
  const detachments = availableDetachments(catalogue);
  const chosenId = selectedDetachment(roster, catalogue);
  const chosen = detachments.find((d) => d.id === chosenId);

  const chip = (step: number, label: string, value: string) => (
    <button className="setup-chip" onClick={() => onEdit(step)}>
      <span className="setup-lbl">{label}</span>
      <span className="setup-val">{value}</span>
      <span className="setup-edit">Change</span>
    </button>
  );

  return (
    <div className="setup-bar" data-testid="setup-bar">
      {chip(0, "Points limit", `${roster.pointsLimit} pts`)}
      {chip(1, "Faction", catalogue.name)}
      {detachments.length > 0 && chip(2, "Detachment", chosen?.name ?? "Choose…")}
    </div>
  );
}
