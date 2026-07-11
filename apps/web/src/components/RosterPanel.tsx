import type { IrCatalogue, IrEntry, Roster, RosterSelection, ValidationResult } from "@muster/domain";
import { UnitConfig } from "./UnitConfig";

/** Resolve a selection's display name from the catalogue, searching nested options too. */
function entryName(entries: IrEntry[], entryId: string): string | undefined {
  for (const e of entries) {
    if (e.id === entryId) return e.name;
    const nested = entryName(e.children, entryId);
    if (nested) return nested;
  }
  return undefined;
}

/** One selection in the roster tree: its controls plus its nested options, rendered recursively. */
function SelectionNode({
  roster, selection, catalogue, depth, onAddOption, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  depth: number;
  onAddOption: (parentId: string, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const name = entryName(catalogue.entries, selection.entryId) ?? selection.entryId;
  return (
    <li style={{
      borderTop: depth === 0 ? "1px solid var(--line)" : "none",
      paddingTop: 6, marginTop: 6, marginLeft: depth * 16,
    }}>
      <strong>{name}</strong>
      <UnitConfig roster={roster} selection={selection} catalogue={catalogue}
        onAddOption={onAddOption} onRemove={onRemove} onSetCount={onSetCount} />
      {selection.selections.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {selection.selections.map((child) => (
            <SelectionNode key={child.id} roster={roster} selection={child} catalogue={catalogue}
              depth={depth + 1} onAddOption={onAddOption} onRemove={onRemove} onSetCount={onSetCount} />
          ))}
        </ul>
      )}
    </li>
  );
}

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
  return (
    <section>
      <h2>Roster</h2>
      <div data-testid="points" style={{ fontWeight: 700, fontSize: 20 }}>
        {result.totalPoints} / {result.pointsLimit} pts
      </div>
      <ul data-testid="roster-list" style={{ listStyle: "none", padding: 0 }}>
        {roster.selections.map((s) => (
          <SelectionNode key={s.id} roster={roster} selection={s} catalogue={catalogue}
            depth={0} onAddOption={onAddOption} onRemove={onRemove} onSetCount={onSetCount} />
        ))}
      </ul>
      <h3>Validation</h3>
      {result.issues.length === 0 ? (
        <div>✓ no issues</div>
      ) : (
        <ul>
          {result.issues.map((i, idx) => (
            <li key={idx} style={{ color: i.severity === "error" ? "var(--error)" : "var(--warn)" }}>
              {i.severity}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
