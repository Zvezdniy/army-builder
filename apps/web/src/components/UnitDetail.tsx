import type { IrCatalogue, IrGroup, Roster } from "@muster/domain";
import { catalogueEntry, isLeaderUnit, leaderTargets } from "@muster/roster";
import { SelectionNode } from "./SelectionNode";
import { Datasheet, UnitStatline } from "./Datasheet";

export function UnitDetail({
  roster, catalogue, selectedUnitId, onBack, onAddOption, onToggleGroupMember,
  onSetGroupMemberCount, onRemove, onSetCount, onAttachLeader, onDetachLeader,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onBack: () => void;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onSetGroupMemberCount: (parentId: string, group: IrGroup, entryId: string, count: number) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
  onAttachLeader: (leaderId: string, bodyguardId: string) => void;
  onDetachLeader: (leaderId: string) => void;
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
      <UnitStatline catalogue={catalogue} roster={roster} selection={sel} />
      {isLeaderUnit(catalogue, sel.entryId) && (
        <AttachSection roster={roster} catalogue={catalogue} leader={sel}
          onAttachLeader={onAttachLeader} onDetachLeader={onDetachLeader} />
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <SelectionNode roster={roster} selection={sel} catalogue={catalogue} depth={0}
          onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
          onSetGroupMemberCount={onSetGroupMemberCount}
          onRemove={onRemove} onSetCount={onSetCount} />
      </ul>
      <Datasheet catalogue={catalogue} roster={roster} selection={sel} />
    </section>
  );
}

function AttachSection({
  roster, catalogue, leader, onAttachLeader, onDetachLeader,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  leader: Roster["selections"][number];
  onAttachLeader: (leaderId: string, bodyguardId: string) => void;
  onDetachLeader: (leaderId: string) => void;
}) {
  if (leader.attachedTo !== undefined) {
    const host = roster.selections.find((s) => s.id === leader.attachedTo);
    const hostName = host ? catalogueEntry(catalogue, host.entryId)?.name ?? host.entryId : "unit";
    return (
      <div className="ud-attach">
        <span className="ud-attach-on">Leading {hostName}</span>
        <button className="ud-attach-detach" onClick={() => onDetachLeader(leader.id)}>Detach</button>
      </div>
    );
  }
  const targets = leaderTargets(roster, catalogue, leader.id);
  if (targets.length === 0) {
    return <div className="ud-attach ud-attach-empty">Add an eligible unit to this roster to attach this Leader.</div>;
  }
  return (
    <div className="ud-attach">
      <span className="ud-attach-label">Attach to unit:</span>
      {targets.map((t) => (
        <button key={t.bodyguardSelectionId} className="ud-attach-target"
          onClick={() => onAttachLeader(leader.id, t.bodyguardSelectionId)}>
          Attach to {t.bodyguardName}
        </button>
      ))}
    </div>
  );
}
