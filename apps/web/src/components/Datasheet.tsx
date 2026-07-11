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

/** Weapons and other multi-column profiles render as a table. */
function ProfileTable({ section }: { section: DatasheetSection }) {
  const columns = section.profiles[0]?.characteristics.map((c) => c.name) ?? [];
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
            <tr key={p.name}>
              <td>{p.name}</td>
              {p.characteristics.map((c) => <td key={c.name}>{c.value}</td>)}
            </tr>
          ))}
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

export function Datasheet({
  catalogue, selection,
}: {
  catalogue: IrCatalogue;
  selection: RosterSelection;
}) {
  const sections = datasheet(catalogue, selection);
  if (sections.length === 0) return null;
  return (
    <div className="ds" data-testid="datasheet">
      {sections.map((section) => {
        if (section.typeName === "Unit") return <Statline key={section.typeName} section={section} />;
        if (section.typeName === "Abilities") return <Abilities key={section.typeName} section={section} />;
        return <ProfileTable key={section.typeName} section={section} />;
      })}
    </div>
  );
}
