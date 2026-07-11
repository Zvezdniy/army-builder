import type { IrCatalogue, IrGroup, Roster } from "@muster/domain";
import { catalogueEntry } from "@muster/roster";
import { SelectionNode } from "./SelectionNode";

export function UnitDetail({
  roster, catalogue, selectedUnitId, onBack, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onBack: () => void;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const sel = selectedUnitId ? roster.selections.find((s) => s.id === selectedUnitId) : undefined;
  if (!sel) {
    return <section className="ud ud-empty">Select a unit on the left</section>;
  }
  const entry = catalogueEntry(catalogue, sel.entryId);
  const name = entry?.name ?? sel.entryId;
  const keywords = (entry?.categories ?? []).map((id) => catalogue.categoryNames?.[id] ?? id);
  return (
    <section className="ud">
      <button className="ud-remove" title="Remove unit" aria-label={`remove ${name}`}
        onClick={() => onRemove(sel.id)}>🗑</button>
      <button className="ud-back" aria-label="back to list" onClick={onBack}>‹ Back</button>
      {keywords.length > 0 && (
        <div className="ud-kw">
          {keywords.map((k) => <span key={k} className="kw">{k}</span>)}
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <SelectionNode roster={roster} selection={sel} catalogue={catalogue} depth={0}
          onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
          onRemove={onRemove} onSetCount={onSetCount} />
      </ul>
    </section>
  );
}
