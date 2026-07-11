import { useState } from "react";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { datasheet, type DatasheetSection } from "@muster/roster";

/** Statline profiles (Unit) render as a row of labelled chips. */
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

/** Weapons and other multi-column profiles render as a table; weapon keyword
 *  abilities render as clickable chips beneath each row. */
function ProfileTable({
  section, onRule,
}: {
  section: DatasheetSection;
  onRule: (keyword: string) => void;
}) {
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
          {section.profiles.map((p) => (
            <ProfileRows key={p.name} profile={p} span={span} onRule={onRule} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileRows({
  profile, span, onRule,
}: {
  profile: DatasheetSection["profiles"][number];
  span: number;
  onRule: (keyword: string) => void;
}) {
  const keywords = profile.keywords ?? [];
  return (
    <>
      <tr>
        <td>{profile.name}</td>
        {profile.characteristics.map((c) => <td key={c.name}>{c.value}</td>)}
      </tr>
      {keywords.length > 0 && (
        <tr className="ds-kw-row">
          <td colSpan={span}>
            {keywords.map((k) => (
              <button key={k} className="ds-kw-chip" aria-label={`${k} rule`} onClick={() => onRule(k)}>
                {k}
              </button>
            ))}
          </td>
        </tr>
      )}
    </>
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

export function Datasheet({
  catalogue, selection,
}: {
  catalogue: IrCatalogue;
  selection: RosterSelection;
}) {
  const sections = datasheet(catalogue, selection);
  const [openRule, setOpenRule] = useState<string | null>(null);
  if (sections.length === 0) return null;
  const ruleText = openRule ? (catalogue.ruleTexts?.[openRule] ?? "Нет описания правила.") : "";
  return (
    <div className="ds" data-testid="datasheet">
      {sections.map((section) => {
        if (section.typeName === "Unit") return <Statline key={section.typeName} section={section} />;
        if (section.typeName === "Abilities") return <Abilities key={section.typeName} section={section} />;
        return <ProfileTable key={section.typeName} section={section} onRule={setOpenRule} />;
      })}
      {openRule && (
        <div className="rule-popup-overlay" role="dialog" aria-label={`${openRule} rule`}
          onClick={() => setOpenRule(null)}>
          <div className="rule-popup" onClick={(e) => e.stopPropagation()}>
            <div className="rule-popup-head">
              <strong>{openRule}</strong>
              <button className="picker-close" aria-label="close" onClick={() => setOpenRule(null)}>✕</button>
            </div>
            <p className="rule-popup-body">{ruleText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
