import { useState } from "react";
import type { IrCatalogue, Roster, StratagemFile, Stratagem } from "@muster/domain";
import { selectStratagems } from "@muster/domain";
import { selectedDetachmentNames } from "@muster/roster";
import { renderStratagemHtml } from "./stratagemHtml";

// Map a stratagem's category to a colour slug + short label. The real data uses the
// five 40k types ("Strategic Ploy", "Battle Tactic", "Epic Deed", "Wargear") plus an
// empty category for Core stratagems; the regexes are tolerant of trailing words.
function categoryMeta(category: string): { slug: string; label: string } {
  const c = category.trim();
  if (/battle\s*tactic/i.test(c)) return { slug: "battle", label: "Battle Tactic" };
  if (/strategic\s*ploy/i.test(c)) return { slug: "ploy", label: "Strategic Ploy" };
  if (/epic\s*deed/i.test(c)) return { slug: "epic", label: "Epic Deed" };
  if (/wargear/i.test(c)) return { slug: "wargear", label: "Wargear" };
  return { slug: "core", label: "Core" };
}

/** One stratagem, collapsed to its name + colour-coded category tag + CP; the meta
 *  line and effect text reveal on click/tap. The card carries a category-coloured left
 *  accent (War Organ-style), so types read at a glance without expanding. */
function StratagemCard({ s }: { s: Stratagem }) {
  const [open, setOpen] = useState(false);
  const cat = categoryMeta(s.category);
  const meta = [s.phase, s.turn].filter(Boolean).join(" · "); // category is now the tag, not meta
  return (
    <div className={`strat-card strat-cat-${cat.slug}`}>
      <button className="strat-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="strat-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="strat-name">{s.name}</span>
        <span className="strat-cat-tag">{cat.label}</span>
        <span className="strat-cp">{s.cpCost}CP</span>
      </button>
      {open && (
        <div className="strat-detail">
          {meta && <div className="strat-meta">{meta}</div>}
          <div className="strat-text">{renderStratagemHtml(s.description)}</div>
        </div>
      )}
    </div>
  );
}

/** A collapsible group (Core, or one detachment): its head shows the group name and
 *  stratagem count; the list of cards reveals on click/tap. Closed by default. */
function StratagemSection({ title, stratagems, emptyHint }: { title: string; stratagems: Stratagem[]; emptyHint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="strat-section">
      <button className="ds-section-head strat-section-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="strat-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="strat-section-title">{title}</span>
        <span className="strat-count">{stratagems.length}</span>
      </button>
      {open && (
        <div className="preview-body">
          {stratagems.length === 0
            ? <div className="preview-empty">{emptyHint ?? "No stratagems."}</div>
            : stratagems.map((s) => <StratagemCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}

/** A collapsible reference panel of the roster's stratagems: Core (always) plus one
 *  section per selected detachment. Renders nothing until stratagem data is loaded. */
export function StratagemPanel({ data, roster, catalogue }: {
  data: { core: StratagemFile; faction?: StratagemFile } | undefined;
  roster: Roster; catalogue: IrCatalogue;
}) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const names = selectedDetachmentNames(roster, catalogue);
  const { core, byDetachment } = selectStratagems(data.core, data.faction, names);
  const summary = `Core + ${byDetachment.length} detachment${byDetachment.length === 1 ? "" : "s"}`;

  return (
    <div className="det-panel" data-testid="stratagem-panel">
      <button className="det-panel-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="det-panel-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="det-panel-title">Stratagems</span>
        <span className="det-panel-names">{summary}</span>
      </button>
      {open && (
        <div className="det-panel-body">
          <StratagemSection title="Core" stratagems={core} />
          {byDetachment.map((g) => (
            <StratagemSection key={g.detachment} title={g.detachment} stratagems={g.stratagems}
              emptyHint="No detachment-specific stratagems found." />
          ))}
        </div>
      )}
    </div>
  );
}
