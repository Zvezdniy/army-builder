import type { IrCatalogue, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments } from "@muster/roster";
import { offerableFactions, editionsOf, type CatalogueDescriptor } from "../registry/catalogueRegistry";
import type { SetupStep } from "./SetupWizard";

/** Persistent, always-editable summary of the army setup: points · (edition) ·
 *  faction · detachment(s). Each chip reopens the wizard on its step. The Edition
 *  chip is omitted when the catalogue library offers only one edition (no choice to
 *  show); the detachment chip is omitted when the catalogue models no detachment.
 *  Several chosen detachments (11e) are joined into one label instead of showing
 *  only the first. */
export function SetupBar({
  catalogue, roster, onEdit, registry, activeDescriptorId,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  onEdit: (step: SetupStep) => void;
  registry?: CatalogueDescriptor[];
  activeDescriptorId?: string;
}) {
  const detachments = availableDetachments(catalogue);
  const chosenNames = selectedDetachments(roster, catalogue)
    .map((id) => detachments.find((d) => d.id === id)?.name)
    .filter((n): n is string => n !== undefined);

  const editions = (() => { const shown = offerableFactions(registry); return shown ? editionsOf(shown) : []; })();
  const currentEditionName = registry?.find((d) => d.id === activeDescriptorId)?.editionName;

  const chip = (step: SetupStep, label: string, value: string) => (
    // The value is clamped to a single line (see .setup-val) so a long faction name
    // ("Imperium - Adeptus Astartes - Space Marines") can't balloon one chip taller
    // than its row-mate on a phone; the title carries the full text for discovery.
    <button className="setup-chip" onClick={() => onEdit(step)} title={value}>
      <span className="setup-lbl">{label}</span>
      <span className="setup-val">{value}</span>
      <span className="setup-edit">Change</span>
    </button>
  );

  return (
    <div className="setup-bar" data-testid="setup-bar">
      {chip("points", "Points limit", `${roster.pointsLimit} pts`)}
      {editions.length > 1 && currentEditionName && chip("edition", "Edition", currentEditionName)}
      {chip("faction", "Faction", catalogue.name)}
      {detachments.length > 0 && chip("detachment", "Detachment", chosenNames.length > 0 ? chosenNames.join(", ") : "Choose…")}
    </div>
  );
}
