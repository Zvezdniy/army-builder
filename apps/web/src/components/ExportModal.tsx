import { useEffect, useMemo, useRef, useState } from "react";
import type { IrCatalogue, Roster } from "@muster/domain";
import { toEnvelope } from "@muster/roster";
import { rosterToText, rosterToTournamentText } from "../rosterText";

type Format = "detailed" | "tournament" | "json";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "detailed", label: "Detailed", hint: "Units by role with points and wargear" },
  { id: "tournament", label: "Tournament (WTC)", hint: "WTC summary header above the full list" },
  { id: "json", label: "File (.json)", hint: "Re-importable Muster roster file" },
];

// A filesystem-safe basename derived from the roster name (mirrors App's JSON export).
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_") || "roster";
}

function download(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** One place to export the active roster: pick a format, see a live preview, then
 *  copy it to the clipboard or download it as a file. Text formats come from
 *  rosterText; the .json format is the re-importable envelope (needs edition +
 *  catalogueId, which App supplies from the active descriptor). */
export function ExportModal({
  roster, catalogue, edition, catalogueId, onClose,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  edition: string;
  catalogueId: string;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>("detailed");
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog on open so Escape (handled on the overlay) fires
  // without the user having to click inside first, and focus doesn't linger on the
  // trigger button behind the overlay.
  useEffect(() => { closeRef.current?.focus(); }, []);

  const text = useMemo(() => {
    if (format === "json") return JSON.stringify(toEnvelope(roster, edition, catalogueId), null, 2);
    if (format === "tournament") return rosterToTournamentText(roster, catalogue, { pointsLimit: roster.pointsLimit });
    return rosterToText(roster, catalogue, { pointsLimit: roster.pointsLimit });
  }, [format, roster, catalogue, edition, catalogueId]);

  const pick = (next: Format) => { setFormat(next); setCopied(false); };

  const copy = () => {
    // navigator.clipboard is absent on insecure origins / older browsers — no-op
    // rather than throw; the download button is always available as a fallback.
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const save = () => {
    const base = safeName(roster.name);
    if (format === "json") download(text, `${base}.muster.json`, "application/json");
    else download(text, `${base}.txt`, "text/plain");
  };

  return (
    <div className="picker-overlay" role="dialog" aria-label="export roster"
      onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="picker exp" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>Export</strong>
          <button ref={closeRef} className="picker-close" aria-label="close" onClick={onClose}>✕</button>
        </div>

        <div className="exp-formats" role="tablist" aria-label="export format">
          {FORMATS.map((f) => (
            <button key={f.id} id={`exp-tab-${f.id}`} role="tab" aria-selected={format === f.id}
              aria-controls="exp-preview" title={f.hint}
              className={`exp-format${format === f.id ? " chosen" : ""}`} onClick={() => pick(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        <pre id="exp-preview" role="tabpanel" aria-labelledby={`exp-tab-${format}`}
          className="exp-preview" data-testid="export-preview" tabIndex={0}>{text}</pre>

        <div className="exp-actions">
          <button className="exp-copy" onClick={copy} disabled={!navigator.clipboard}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button className="exp-save" onClick={save}>
            {format === "json" ? "Download .json" : "Download .txt"}
          </button>
        </div>
      </div>
    </div>
  );
}
