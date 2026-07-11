import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import { createRoster } from "@muster/roster";
import { evaluate } from "@muster/engine-eval";
import mini40k from "./mini40k.ir.json";

export function App() {
  const [catalogue] = useState<IrCatalogue>(() => IrCatalogueSchema.parse(mini40k));
  const [roster] = useState(() => createRoster(catalogue, 2000));
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1>Muster — {catalogue.name}</h1>
      <div data-testid="points">
        {result.totalPoints} / {result.pointsLimit} pts
      </div>
    </main>
  );
}
