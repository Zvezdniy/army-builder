import { Fragment, useState } from "react";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { datasheet, type DatasheetSection } from "@muster/roster";

/** Devices that can hover (desktop) show rule popups on hover; touch shows on tap. */
const canHover =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: hover)").matches;

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

/** The unit's statline bar (Unit profile) — rendered on its own, right under the name. */
export function UnitStatline({ catalogue, selection }: { catalogue: IrCatalogue; selection: RosterSelection }) {
  const unit = datasheet(catalogue, selection).find((s) => s.typeName === "Unit");
  return unit ? <Statline section={unit} /> : null;
}

type RuleHandlers = {
  onShow: (keyword: string, el: HTMLElement) => void;
  onHide: () => void;
  onToggle: (keyword: string, el: HTMLElement) => void;
};

/** Weapons and other multi-column profiles render as a table; weapon keyword
 *  abilities render as chips that reveal their rule on hover (desktop) or tap. */
function ProfileTable({ section, rules }: { section: DatasheetSection; rules: RuleHandlers }) {
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

/** Abilities render as name + description blocks. */
function Abilities({ section }: { section: DatasheetSection }) {
  return (
    <div className="ds-abilities">
      {section.profiles.map((p) => (
        <p key={p.name}>
          <strong>{p.name}.</strong>{" "}
          {p.characteristics.find((c) => c.name === "Description")?.value ?? ""}
        </p>
      ))}
    </div>
  );
}

/** The datasheet sections OTHER than the Unit statline (abilities, weapon tables).
 *  The statline is rendered separately via UnitStatline, directly under the name. */
export function Datasheet({
  catalogue, selection,
}: {
  catalogue: IrCatalogue;
  selection: RosterSelection;
}) {
  const sections = datasheet(catalogue, selection).filter((s) => s.typeName !== "Unit");
  const [tip, setTip] = useState<{ kw: string; x: number; y: number } | null>(null);
  if (sections.length === 0) return null;

  const at = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 6 };
  };
  const rules: RuleHandlers = {
    onShow: (kw, el) => setTip({ kw, ...at(el) }),
    onHide: () => setTip(null),
    onToggle: (kw, el) => setTip((prev) => (prev?.kw === kw ? null : { kw, ...at(el) })),
  };
  const ruleText = tip ? (catalogue.ruleTexts?.[tip.kw] ?? "Нет описания правила.") : "";

  return (
    <div className="ds" data-testid="datasheet">
      {sections.map((section) =>
        section.typeName === "Abilities"
          ? <Abilities key={section.typeName} section={section} />
          : <ProfileTable key={section.typeName} section={section} rules={rules} />,
      )}
      {tip && (
        <div className="rule-tip" role="tooltip" style={{ position: "fixed", left: tip.x, top: tip.y }}>
          <strong className="rule-tip-name">{tip.kw}</strong>
          <span>{ruleText}</span>
        </div>
      )}
    </div>
  );
}
