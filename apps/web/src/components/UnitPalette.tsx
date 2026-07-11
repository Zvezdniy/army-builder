import type { IrEntry } from "@muster/domain";

function points(e: IrEntry): number {
  return e.costs.find((c) => c.name === "points")?.value ?? 0;
}

export function UnitPalette({ units, onAdd }: { units: IrEntry[]; onAdd: (entryId: string) => void }) {
  return (
    <section className="palette">
      <h2>Units</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {units.map((u) => (
          <li key={u.id}>
            <button onClick={() => onAdd(u.id)} aria-label={`add ${u.name}`}
              style={{ width: "100%", textAlign: "left", padding: 8, cursor: "pointer" }}>
              {u.name} — {points(u)} pts
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
