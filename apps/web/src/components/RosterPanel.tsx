import type { IrCatalogue, IrGroup, Roster, RosterSelection, ValidationResult } from "@muster/domain";
import { catalogueEntry } from "@muster/roster";
import { UnitConfig } from "./UnitConfig";

/** One selection in the roster tree: its controls plus its nested options, rendered recursively. */
function SelectionNode({
  roster, selection, catalogue, depth, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  depth: number;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const entry = catalogueEntry(catalogue, selection.entryId);
  const name = entry?.name ?? selection.entryId;
  // Group members are controlled by their group's radio/toggle in UnitConfig, so
  // they must NOT also appear as their own nested node — only free (non-group)
  // children get a node (their stepper/remove lives nowhere else).
  const groupMemberIds = new Set((entry?.groups ?? []).flatMap((g) => g.memberEntryIds));
  const freeChildren = selection.selections.filter((c) => !groupMemberIds.has(c.entryId));
  return (
    <li style={{
      borderTop: depth === 0 ? "1px solid var(--line)" : "none",
      paddingTop: 6, marginTop: 6, marginLeft: depth * 16,
    }}>
      <strong>{name}</strong>
      <UnitConfig roster={roster} selection={selection} catalogue={catalogue}
        onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
        onRemove={onRemove} onSetCount={onSetCount} />
      {freeChildren.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {freeChildren.map((child) => (
            <SelectionNode key={child.id} roster={roster} selection={child} catalogue={catalogue}
              depth={depth + 1} onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
              onRemove={onRemove} onSetCount={onSetCount} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function RosterPanel({
  roster, catalogue, result, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  result: ValidationResult;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
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
            depth={0} onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
            onRemove={onRemove} onSetCount={onSetCount} />
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
