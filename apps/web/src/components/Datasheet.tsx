import { Fragment, useState } from "react";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { datasheet, unitLoadout, type DatasheetSection } from "@muster/roster";

/** Devices that can hover (desktop) show rule popups on hover; touch shows on tap. */
const canHover =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: hover)").matches;

const WEAPON_TYPES = new Set(["Ranged Weapons", "Melee Weapons"]);

/** The invulnerable save resolved for the statline chip: its value ("4+"), the
 *  source profile's name, and whether the source text is a BARE save (just "N+",
 *  nothing else) — a bare one is redundant with the chip and dropped from the
 *  Abilities list, while a qualified one ("5+ against ranged attacks", or a
 *  footnoted "4+\n* …melee…") stays so its condition remains visible. */
interface InvulnInfo {
  value: string;
  sourceName: string;
  bare: boolean;
}

/** First "N+" save token in a string, or undefined. Handles a bare "4+", a
 *  sentence ("This model has a 5+ invulnerable save…"), and a footnoted
 *  "4+\n* …". First-match: in every real invuln-ability form the save is the
 *  leading "N+" token, and the caller only runs this on invuln-named abilities,
 *  so an unrelated earlier "N+" in prose is not a concern in practice. */
function extractSavePlus(text: string): string | undefined {
  const m = text.match(/(\d+)\+/);
  return m ? `${m[1]}+` : undefined;
}

/**
 * Resolve a unit's invulnerable save from its datasheet sections. Real BSData
 * encodes it as an "Abilities" profile named "Invulnerable Save" (sometimes with a
 * trailing "*"), the value in its Description characteristic. Synthetic/legacy data
 * uses a dedicated "Invulnerable Save" typeName. Returns undefined when there is no
 * invuln or no parseable save value (so a broken chip never shows).
 */
function findInvuln(sections: DatasheetSection[]): InvulnInfo | undefined {
  // Legacy/synthetic: a dedicated section whose single characteristic is the save.
  const dedicated = sections.find((s) => s.typeName === "Invulnerable Save")?.profiles[0];
  if (dedicated) {
    const raw = dedicated.characteristics[0]?.value ?? "";
    const value = extractSavePlus(raw) ?? raw.trim();
    return value ? { value, sourceName: dedicated.name, bare: true } : undefined;
  }
  // Real data: an "Invulnerable Save[*]" ability inside the Abilities section.
  const abilities = sections.find((s) => s.typeName === "Abilities");
  const inv = abilities?.profiles.find((p) => /^invulnerable save/i.test(p.name));
  if (!inv) return undefined;
  const raw = inv.characteristics.find((c) => c.name === "Description")?.value ?? "";
  const value = extractSavePlus(raw);
  if (!value) return undefined;
  // Bare = the description is exactly the save value (no qualifying prose/footnote).
  return { value, sourceName: inv.name, bare: raw.trim() === value };
}

/** The Unit statline as a prominent, evenly-divided stat bar. */
function Statline({ section }: { section: DatasheetSection }) {
  const profile = section.profiles[0];
  if (!profile) return null;
  return (
    <div className="ds-statline">
      {profile.characteristics.map((c) => (
        <div key={c.name} className="ds-chip">
          <span className="ds-chip-label">{c.name}</span>
          <span className="ds-chip-value">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The unit's statline bar with the invulnerable-save chip hanging under the
 *  Toughness column, the way a datasheet shows it. */
export function UnitStatline({ catalogue, selection }: { catalogue: IrCatalogue; selection: RosterSelection }) {
  const sections = datasheet(catalogue, selection);
  const unit = sections.find((s) => s.typeName === "Unit");
  const invuln = findInvuln(sections);
  if (!unit) return null;
  const chars = unit.profiles[0]?.characteristics ?? [];
  const tIndex = chars.findIndex((c) => c.name === "T");
  return (
    <div className="ds-statwrap">
      <Statline section={unit} />
      {invuln && chars.length > 0 && (
        <div className="ds-invuln-row" style={{ gridTemplateColumns: `repeat(${chars.length}, 1fr)` }}>
          <div className="ds-invuln" style={{ gridColumn: (tIndex >= 0 ? tIndex : 1) + 1 }}>
            <span className="ds-invuln-value">{invuln.value}</span>
            <span className="ds-invuln-label">Invulnerable Save</span>
          </div>
        </div>
      )}
    </div>
  );
}

type RuleHandlers = {
  onShow: (keyword: string, el: HTMLElement) => void;
  onHide: () => void;
  onToggle: (keyword: string, el: HTMLElement) => void;
};

/** Weapons render as a table; keyword abilities become chips that reveal their
 *  rule on hover (desktop) or tap. The table head reads as the section bar. */
function WeaponTable({ section, rules }: { section: DatasheetSection; rules: RuleHandlers }) {
  const columns = section.profiles[0]?.characteristics.map((c) => c.name) ?? [];
  const span = columns.length + 1;
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>{section.typeName}</th>
            {columns.map((name) => <th key={name}>{name}</th>)}
          </tr>
        </thead>
        <tbody>
          {section.profiles.map((p) => {
            const keywords = p.keywords ?? [];
            return (
              <Fragment key={p.name}>
                <tr>
                  <td>{p.name}</td>
                  {p.characteristics.map((c) => <td key={c.name}>{c.value}</td>)}
                </tr>
                {keywords.length > 0 && (
                  <tr className="ds-kw-row">
                    <td colSpan={span}>
                      {keywords.map((k) => (
                        <button key={k} className="ds-kw-chip" aria-label={`${k} rule`}
                          onMouseEnter={canHover ? (e) => rules.onShow(k, e.currentTarget) : undefined}
                          onMouseLeave={canHover ? rules.onHide : undefined}
                          onClick={(e) => rules.onToggle(k, e.currentTarget)}>
                          {k}
                        </button>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Read-only loadout readout ("X equipped with: a, b"), the way War Organ summarizes wargear. */
function Composition({ loadout }: { loadout: { unit: string; wargear: string[] } }) {
  return (
    <div className="ds-section">
      <div className="ds-section-head">Unit Composition &amp; Wargear</div>
      <p className="ds-loadout">{loadout.unit} equipped with: {loadout.wargear.join(", ")}.</p>
    </div>
  );
}

/** Abilities: grouped ones (Core/Faction) collapse to one compact line per group;
 *  ungrouped ones render as name + description. */
function Abilities({ section }: { section: DatasheetSection }) {
  const groups = new Map<string, string[]>();
  const named: DatasheetSection["profiles"] = [];
  for (const p of section.profiles) {
    if (p.group) {
      const list = groups.get(p.group) ?? [];
      list.push(p.name);
      groups.set(p.group, list);
    } else {
      named.push(p);
    }
  }
  return (
    <div className="ds-section">
      <div className="ds-section-head">Abilities</div>
      {[...groups].map(([group, names]) => (
        <p key={group} className="ds-ability-line">
          <strong>{group.toUpperCase()}:</strong> {names.join(", ")}
        </p>
      ))}
      {named.map((p) => (
        <p key={p.name} className="ds-ability">
          <strong>{p.name}.</strong>{" "}
          {p.characteristics.find((c) => c.name === "Description")?.value ?? ""}
        </p>
      ))}
    </div>
  );
}

/** A special rule block (Supreme Commander, Damaged, …): a titled section of
 *  descriptive paragraphs, keyed off the profile's typeName. */
function SpecialSection({ section }: { section: DatasheetSection }) {
  return (
    <div className="ds-section">
      <div className="ds-section-head">{section.typeName}</div>
      {section.profiles.map((p) => {
        const desc = p.characteristics.find((c) => c.name === "Description")?.value ?? "";
        return (
          <p key={p.name} className="ds-ability">
            {p.name !== section.typeName && <><strong>{p.name}.</strong>{" "}</>}
            {desc}
          </p>
        );
      })}
    </div>
  );
}

const RESERVED = new Set(["Unit", "Invulnerable Save", "Abilities"]);

/** The two-column datasheet body: weapons on the left; composition, abilities and
 *  special rules on the right. The statline/invuln sit above it (UnitStatline). */
export function Datasheet({
  catalogue, selection,
}: {
  catalogue: IrCatalogue;
  selection: RosterSelection;
}) {
  const all = datasheet(catalogue, selection);
  const weapons = all.filter((s) => WEAPON_TYPES.has(s.typeName));
  const specials = all.filter((s) => !WEAPON_TYPES.has(s.typeName) && !RESERVED.has(s.typeName));
  const loadout = unitLoadout(catalogue, selection);
  const [tip, setTip] = useState<{ kw: string; x: number; y: number } | null>(null);

  // The invuln chip (in UnitStatline) already shows a bare "N+"; drop that same
  // ability line here to avoid showing it twice. A qualified invuln (extra prose or
  // a footnote) stays, so its condition — e.g. "against ranged attacks" — is visible.
  const invuln = findInvuln(all);
  const abilitiesRaw = all.find((s) => s.typeName === "Abilities");
  const abilities = abilitiesRaw && invuln?.bare
    ? { ...abilitiesRaw, profiles: abilitiesRaw.profiles.filter((p) => p.name !== invuln.sourceName) }
    : abilitiesRaw;
  const hasAbilities = !!abilities && abilities.profiles.length > 0;

  const hasRight = loadout.wargear.length > 0 || hasAbilities || specials.length > 0;
  if (weapons.length === 0 && !hasRight) return null;

  const at = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 6 };
  };
  const rules: RuleHandlers = {
    onShow: (kw, el) => setTip({ kw, ...at(el) }),
    onHide: () => setTip(null),
    onToggle: (kw, el) => setTip((prev) => (prev?.kw === kw ? null : { kw, ...at(el) })),
  };
  const ruleText = tip ? (catalogue.ruleTexts?.[tip.kw] ?? "No rule description.") : "";

  return (
    <div className="ds" data-testid="datasheet">
      <div className="ds-cols">
        <div className="ds-col">
          {weapons.map((section) => <WeaponTable key={section.typeName} section={section} rules={rules} />)}
        </div>
        <div className="ds-col">
          {loadout.wargear.length > 0 && <Composition loadout={loadout} />}
          {hasAbilities && <Abilities section={abilities!} />}
          {specials.map((section) => <SpecialSection key={section.typeName} section={section} />)}
        </div>
      </div>
      {tip && (
        <div className="rule-tip" role="tooltip" style={{ position: "fixed", left: tip.x, top: tip.y }}>
          <strong className="rule-tip-name">{tip.kw}</strong>
          <span>{ruleText}</span>
        </div>
      )}
    </div>
  );
}
