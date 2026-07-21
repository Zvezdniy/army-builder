import { useState } from "react";
import type { RosterLibrary } from "@muster/domain";

function when(ts: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function MyArmies({
  library, onOpen, onRename, onDuplicate, onDelete, onExport, onImport, onNew, onClose,
}: {
  library: RosterLibrary;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (file: File) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const nowMs = Date.now();
  const entries = [...library.entries].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="picker-overlay" role="dialog" aria-label="my armies" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>My armies</strong>
          <button className="picker-close" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <div className="picker-actions" style={{ display: "flex", gap: 8, padding: "8px 0" }}>
          <button onClick={onNew}>+ New army</button>
          <label style={{ fontSize: 13 }}>
            Import:{" "}
            <input type="file" accept="application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
        <div className="picker-list">
          {entries.length === 0 && <div className="picker-empty">No saved armies yet</div>}
          {entries.map((e) => (
            <div key={e.id} className="army-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
              {renaming === e.id ? (
                <input autoFocus value={draft} aria-label={`rename ${e.name}`}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onBlur={() => { onRename(e.id, draft.trim() || e.name); setRenaming(undefined); }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") { onRename(e.id, draft.trim() || e.name); setRenaming(undefined); }
                    else if (ev.key === "Escape") { setRenaming(undefined); }
                  }} />
              ) : (
                <>
                  <button className="army-open" aria-label={`open ${e.name}`} style={{ flex: 1, textAlign: "left" }}
                    onClick={() => onOpen(e.id)}>
                    <strong>{e.name}</strong>{" — "}
                    <span>{e.catalogueName}</span>{" · "}
                    <span>{e.points} pts</span>{" · "}
                    <span>{when(e.updatedAt, nowMs)}</span>
                  </button>
                  <button aria-label={`rename ${e.name}`} onClick={() => { setRenaming(e.id); setDraft(e.name); }}>✎</button>
                  <button aria-label={`duplicate ${e.name}`} onClick={() => onDuplicate(e.id)}>⧉</button>
                  <button aria-label={`export ${e.name}`} onClick={() => onExport(e.id)}>⭳</button>
                  <button aria-label={`delete ${e.name}`} onClick={() => { if (confirm(`Delete "${e.name}"?`)) onDelete(e.id); }}>✕</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
