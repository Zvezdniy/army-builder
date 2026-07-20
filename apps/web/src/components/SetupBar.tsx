import type { IrCatalogue, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments } from "@muster/roster";

/** Persistent, always-editable summary of the army setup: points · faction ·
 *  detachment(s). Each chip reopens the wizard on its step. The detachment chip is
 *  omitted when the catalogue models no detachment; several chosen detachments (11e)
 *  are joined into one label instead of showing only the first. */
export function SetupBar({
  catalogue, roster, onEdit,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  onEdit: (step: number) => void;
}) {
  const detachments = availableDetachments(catalogue);
  const chosenNames = selectedDetachments(roster, catalogue)
    .map((id) => detachments.find((d) => d.id === id)?.name)
    .filter((n): n is string => n !== undefined);

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
      {detachments.length > 0 && chip(2, "Detachment", chosenNames.length > 0 ? chosenNames.join(", ") : "Choose…")}
    </div>
  );
}
