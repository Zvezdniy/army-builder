import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { IrCatalogue, IrCharacteristic, IrProfile, Roster, RosterSelection } from "@muster/domain";
import { unitLoadout, invulnSave } from "@muster/roster";
import { effectiveDatasheet, type DatasheetSection } from "@muster/engine-eval";
import { weaponKeywords, makeRuleResolver, KEYWORDS_CHARACTERISTIC, type WeaponKeyword } from "../keywords";
import { placeTooltip } from "../tooltip";

/** Devices that can hover (desktop) show rule popups on hover; touch shows on tap. */
const canHover =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: hover)").matches;

const WEAPON_TYPES = new Set(["Ranged Weapons", "Melee Weapons"]);

/** The Unit statline as a prominent, evenly-divided stat bar. */
function Statline({ characteristics }: { characteristics: IrCharacteristic[] }) {
  return (
    <div className="ds-statline">
      {characteristics.map((c) => (
        <div key={c.name} className="ds-chip">
          <span className="ds-chip-label">{c.name}</span>
          <span className="ds-chip-value">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

/** 11e carries the invulnerable save as a native `InSv` characteristic on the Unit
 *  profile; 10e has no such characteristic and buries it in an Abilities profile
 *  (which `invulnSave` digs out). Rendering `InSv` as just another statline column
 *  would both split the two editions' presentation and waste a column on the ~92%
 *  of units whose value is blank — so it is pulled OUT of the columns here and fed
 *  to the same chip 10e uses. Blank/whitespace means "no invulnerable save"; the
 *  value is trimmed (real data has a trailing newline on one) and any trailing "*"
 *  is kept, since it flags a qualified save explained in the unit's rules. */
const INVULN_CHARACTERISTIC = "InSv";

function nativeInvuln(characteristics: IrCharacteristic[]): string | undefined {
  const value = characteristics.find((c) => c.name === INVULN_CHARACTERISTIC)?.value.trim();
  return value ? value : undefined;
}

/** The unit's statline bars — ONE PER MODEL PROFILE, each with its own
 *  invulnerable-save chip hanging under the Toughness column, the way a datasheet
 *  shows it.
 *
 *  A mixed unit genuinely has several statlines (Wolf Guard Terminators: a Pack
 *  Leader plus two differently-armed Terminators), and 667 of ~700 real 10e units
 *  and 668 of ~700 in 11e carry more than one. Rendering only `profiles[0]` showed
 *  ONE arbitrary model — whichever selection happened to sort first — and, since
 *  11e stores the invuln per model, silently took the chip with it: zeroing the
 *  default Terminators left the Pack Leader (who has no invuln) first, so a unit
 *  whose every other model has a 4+ displayed none at all. */
export function UnitStatline({
  catalogue, roster, selection,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  selection: RosterSelection;
}) {
  const sections = useMemo(
    () => effectiveDatasheet(catalogue, roster, selection.id),
    [catalogue, roster, selection.id],
  );
  const unit = sections.find((s) => s.typeName === "Unit");
  if (!unit) return null;
  // 10e keeps the invuln in a unit-wide Abilities profile, so it backs EVERY model
  // row; 11e's per-model `InSv` (already modifier-applied, since it comes from
  // effectiveDatasheet) wins for the row that carries one.
  const unitWide = invulnSave(catalogue, selection)?.value;
  return (
    <>
      {unit.profiles.map((profile, i) => (
        <ModelStatline key={`${profile.name}-${i}`} profile={profile}
          showName={unit.profiles.length > 1} unitWideInvuln={unitWide} />
      ))}
    </>
  );
}

function ModelStatline({
  profile, showName, unitWideInvuln,
}: {
  profile: IrProfile;
  showName: boolean;
  unitWideInvuln: string | undefined;
}) {
  const invulnValue = nativeInvuln(profile.characteristics) ?? unitWideInvuln;
  const chars = profile.characteristics.filter((c) => c.name !== INVULN_CHARACTERISTIC);
  const tIndex = chars.findIndex((c) => c.name === "T");
  return (
    <div className="ds-statwrap">
      {showName && <div className="ds-model-name">{profile.name}</div>}
      <Statline characteristics={chars} />
      {invulnValue && chars.length > 0 && (
        <div className="ds-invuln-row" style={{ gridTemplateColumns: `repeat(${chars.length}, 1fr)` }}>
          <div className="ds-invuln" style={{ gridColumn: (tIndex >= 0 ? tIndex : 1) + 1 }}>
            <span className="ds-invuln-value">{invulnValue}</span>
            <span className="ds-invuln-label">Invulnerable Save</span>
          </div>
        </div>
      )}
    </div>
  );
}

type RuleHandlers = {
  onShow: (kw: WeaponKeyword, el: HTMLElement) => void;
  onHide: () => void;
  onToggle: (kw: WeaponKeyword, el: HTMLElement) => void;
};

/** Weapons render as a table; keyword abilities become chips that reveal their
 *  rule on hover (desktop) or tap. The table head reads as the section bar.
 *
 *  The "Keywords" characteristic is pulled OUT of the columns: on real data it is
 *  where the keywords actually live, and rendering it as a plain column would both
 *  duplicate the chips below and waste a wide column on a comma list. */
function WeaponTable({ section, rules }: { section: DatasheetSection; rules: RuleHandlers }) {
  const isKw = (name: string) => name === KEYWORDS_CHARACTERISTIC;
  const columns = (section.profiles[0]?.characteristics ?? [])
    .map((c) => c.name).filter((name) => !isKw(name));
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
            const keywords = weaponKeywords(p);
            return (
              <Fragment key={p.name}>
                <tr>
                  <td>{p.name}</td>
                  {p.characteristics.filter((c) => !isKw(c.name))
                    .map((c) => <td key={c.name}>{c.value}</td>)}
                </tr>
                {keywords.length > 0 && (
                  <tr className="ds-kw-row">
                    <td colSpan={span}>
                      {keywords.map((k) => (
                        <button key={k.label} className="ds-kw-chip" aria-label={`${k.label} rule`}
                          onMouseEnter={canHover ? (e) => rules.onShow(k, e.currentTarget) : undefined}
                          onMouseLeave={canHover ? rules.onHide : undefined}
                          onClick={(e) => rules.onToggle(k, e.currentTarget)}>
                          {k.label}
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
  catalogue, roster, selection,
}: {
  catalogue: IrCatalogue;
  roster: Roster;
  selection: RosterSelection;
}) {
  const all = useMemo(
    () => effectiveDatasheet(catalogue, roster, selection.id),
    [catalogue, roster, selection.id],
  );
  const weapons = all.filter((s) => WEAPON_TYPES.has(s.typeName));
  const specials = all.filter((s) => !WEAPON_TYPES.has(s.typeName) && !RESERVED.has(s.typeName));
  const loadout = unitLoadout(catalogue, selection);
  type Anchor = { top: number; bottom: number; left: number };
  const [tip, setTip] = useState<{ kw: WeaponKeyword; anchor: Anchor } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // Final on-screen position, computed after the tooltip is measured (below/flip/clamp).
  // Null until measured so the first paint doesn't flash at an off-screen spot.
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const resolveRule = useMemo(() => makeRuleResolver(catalogue.ruleTexts), [catalogue.ruleTexts]);

  useLayoutEffect(() => {
    if (!tip || !tipRef.current) { setTipPos(null); return; }
    const t = tipRef.current.getBoundingClientRect();
    setTipPos(placeTooltip(tip.anchor, { width: t.width, height: t.height },
      { width: window.innerWidth, height: window.innerHeight }));
  }, [tip]);

  // The invuln chip (in UnitStatline) already shows a bare "N+"; drop that same
  // ability line here to avoid showing it twice. A qualified invuln (extra prose or
  // a footnote) stays, so its condition — e.g. "against ranged attacks" — is visible.
  const invuln = invulnSave(catalogue, selection);
  const abilitiesRaw = all.find((s) => s.typeName === "Abilities");
  const abilities = abilitiesRaw && invuln?.bare
    ? { ...abilitiesRaw, profiles: abilitiesRaw.profiles.filter((p) => p.name !== invuln.sourceName) }
    : abilitiesRaw;
  const hasAbilities = !!abilities && abilities.profiles.length > 0;

  const hasRight = loadout.wargear.length > 0 || hasAbilities || specials.length > 0;
  if (weapons.length === 0 && !hasRight) return null;

  const at = (el: HTMLElement): Anchor => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left };
  };
  const rules: RuleHandlers = {
    onShow: (kw, el) => setTip({ kw, anchor: at(el) }),
    onHide: () => setTip(null),
    onToggle: (kw, el) => setTip((prev) => (prev?.kw.label === kw.label ? null : { kw, anchor: at(el) })),
  };
  const ruleText = tip ? (resolveRule(tip.kw.ruleKey) ?? "No rule description.") : "";

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
        <div ref={tipRef} className="rule-tip" role="tooltip"
          style={{
            position: "fixed",
            left: tipPos?.left ?? tip.anchor.left,
            top: tipPos?.top ?? tip.anchor.bottom + 6,
            visibility: tipPos ? "visible" : "hidden",
          }}>
          <strong className="rule-tip-name">{tip.kw.label}</strong>
          <span>{ruleText}</span>
        </div>
      )}
    </div>
  );
}
