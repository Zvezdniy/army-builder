import type { IrCatalogue, Roster, ValidationResult } from "@muster/domain";
import { UnitConfig } from "./UnitConfig";

export function RosterPanel({
  roster, catalogue, result, onAddOption, onRemove, onSetCount,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  result: ValidationResult;
  onAddOption: (parentId: string, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const nameOf = (entryId: string) => roster.selections.length
    ? catalogue.entries.find((e) => e.id === entryId)?.name ?? entryId
    : entryId;
  return (
    <section>
      <h2>Roster</h2>
      <div data-testid="points" style={{ fontWeight: 700, fontSize: 20 }}>
        {result.totalPoints} / {result.pointsLimit} pts
      </div>
      <ul data-testid="roster-list" style={{ listStyle: "none", padding: 0 }}>
        {roster.selections.map((s) => (
          <li key={s.id} style={{ borderTop: "1px solid #ccc", paddingTop: 6, marginTop: 6 }}>
            <strong>{nameOf(s.entryId)}</strong>
            <UnitConfig roster={roster} selection={s} catalogue={catalogue}
              onAddOption={onAddOption} onRemove={onRemove} onSetCount={onSetCount} />
          </li>
        ))}
      </ul>
      <h3>Validation</h3>
      {result.issues.length === 0 ? (
        <div>✓ no issues</div>
      ) : (
        <ul>
          {result.issues.map((i, idx) => (
            <li key={idx} style={{ color: i.severity === "error" ? "#b00" : "#a60" }}>
              {i.severity}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
