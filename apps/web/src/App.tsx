import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { loadCatalogue } from "@muster/domain";
import { createRoster, addUnit, addOption, toggleGroupMember, setCount, remove,
  setDetachment, setPointsLimit, availableDetachments, selectedDetachment } from "@muster/roster";
import { evaluate, hiddenEntryIds, hiddenSelectionIds } from "@muster/engine-eval";
import { RosterList } from "./components/RosterList";
import { UnitDetail } from "./components/UnitDetail";
import { AddUnitPicker } from "./components/AddUnitPicker";
import { SetupWizard } from "./components/SetupWizard";
import { SetupBar } from "./components/SetupBar";
import { LegalityPanel } from "./components/LegalityPanel";
import mini40k from "./mini40k.ir.json";

// The setup wizard auto-opens for a fresh army when the catalogue models detachments
// but none is chosen yet (matched-play requires a detachment).
function needsSetup(catalogue: IrCatalogue, roster: ReturnType<typeof createRoster>): boolean {
  return availableDetachments(catalogue).length > 0 && selectedDetachment(roster, catalogue) === undefined;
}

export function App() {
  const [catalogue, setCatalogue] = useState<IrCatalogue>(() => loadCatalogue(mini40k));
  const [roster, setRoster] = useState(() => createRoster(catalogue, 2000));
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(() => needsSetup(catalogue, roster));
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);
  const hiddenIds = useMemo(() => hiddenEntryIds(roster, catalogue), [roster, catalogue]);
  const hiddenSelIds = useMemo(() => hiddenSelectionIds(roster, catalogue), [roster, catalogue]);

  const loadIr = async (file: File) => {
    const parsed = loadCatalogue(JSON.parse(await file.text()));
    const nextRoster = createRoster(parsed, 2000);
    setCatalogue(parsed);
    setRoster(nextRoster);
    setSelectedUnitId(undefined);
    setPickerOpen(false);
    setWizardStep(0);
    setWizardOpen(needsSetup(parsed, nextRoster));
  };

  const openWizardAt = (step: number) => { setWizardStep(step); setWizardOpen(true); };

  // Add a unit and focus it, so its config/datasheet render immediately.
  // addUnit is called once (not in an updater) so its fresh id is knowable and
  // stable under StrictMode's double-invocation.
  const addAndSelect = (entryId: string) => {
    const next = addUnit(roster, entryId, catalogue);
    setRoster(next);
    setSelectedUnitId(next.selections[next.selections.length - 1]?.id);
    setPickerOpen(false);
  };

  const handleRemove = (id: string) => {
    const next = remove(roster, id);
    setRoster(next);
    if (!next.selections.some((s) => s.id === selectedUnitId)) setSelectedUnitId(undefined);
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Muster — {catalogue.name}</h1>
        <label style={{ fontSize: 13 }}>
          load IR:{" "}
          <input type="file" accept="application/json"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadIr(f); }} />
        </label>
      </header>
      <SetupBar catalogue={catalogue} roster={roster} onEdit={openWizardAt} />
      <LegalityPanel
        result={result}
        // Resolves the name of a TOP-LEVEL unit. Issues carrying a nested
        // selection id (e.g. selection.hidden on a sub-selection) fall back to
        // "Unit" and focus nothing actionable — an accepted v1 limitation, since
        // UnitDetail also addresses only top-level selections.
        unitNameOf={(selectionId) => {
          const sel = roster.selections.find((s) => s.id === selectionId);
          return sel ? catalogue.entries.find((e) => e.id === sel.entryId)?.name : undefined;
        }}
        onEditPoints={() => openWizardAt(0)}
        onFocusUnit={setSelectedUnitId}
      />
      <div className="builder" data-view={selectedUnitId ? "detail" : "list"}>
        <RosterList roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onSelect={setSelectedUnitId} onOpenPicker={() => setPickerOpen(true)} hiddenIds={hiddenSelIds} />
        <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onBack={() => setSelectedUnitId(undefined)}
          onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid))}
          onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid))}
          onRemove={handleRemove}
          onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))} />
      </div>
      {pickerOpen && (
        <AddUnitPicker catalogue={catalogue} hiddenIds={hiddenIds} onAdd={addAndSelect} onClose={() => setPickerOpen(false)} />
      )}
      {wizardOpen && (
        <SetupWizard catalogue={catalogue} roster={roster} initialStep={wizardStep}
          onSetPoints={(n) => setRoster((r) => setPointsLimit(r, n))}
          onSetDetachment={(id) => setRoster((r) => setDetachment(r, id, catalogue))}
          onClose={() => setWizardOpen(false)} />
      )}
    </main>
  );
}
