import type { IrCatalogue, IrGroup, Roster, RosterSelection } from "@muster/domain";
import { catalogueEntry } from "@muster/roster";
import { UnitConfig } from "./UnitConfig";
import { Datasheet, UnitStatline } from "./Datasheet";

/** One selection in the roster tree: its controls, its datasheet (top level), and its nested options. */
export function SelectionNode({
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
  const groupMemberIds = new Set((entry?.groups ?? []).flatMap((g) => g.memberEntryIds));
  const freeChildren = selection.selections.filter((c) => !groupMemberIds.has(c.entryId));
  return (
    <li style={{
      borderTop: depth === 0 ? "1px solid var(--line)" : "none",
      paddingTop: 6, marginTop: 6, marginLeft: depth * 16,
    }}>
      {depth === 0
        ? <h2 className="ud-name">{name}</h2>
        : <strong>{name}</strong>}
      {depth === 0 && <UnitStatline catalogue={catalogue} selection={selection} />}
      {depth === 0 && <Datasheet catalogue={catalogue} selection={selection} />}
      <UnitConfig roster={roster} selection={selection} catalogue={catalogue} canRemove={depth > 0}
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
