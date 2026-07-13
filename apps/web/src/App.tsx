import { useEffect, useMemo, useState } from "react";
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
import { bundledDescriptor, loadRegistry, loadCatalogueFor, type CatalogueDescriptor } from "./registry/catalogueRegistry";
import mini40k from "./mini40k.ir.json";

// The setup wizard auto-opens for a fresh army when the catalogue models detachments
// but none is chosen yet (matched-play requires a detachment).
function needsSetup(catalogue: IrCatalogue, roster: ReturnType<typeof createRoster>): boolean {
  return availableDetachments(catalogue).length > 0 && selectedDetachment(roster, catalogue) === undefined;
}

// The bundled fixture is always the first, always-available faction. Built once.
const bundled = bundledDescriptor(mini40k);

export function App() {
  const [catalogue, setCatalogue] = useState<IrCatalogue>(() => loadCatalogue(mini40k));
  const [roster, setRoster] = useState(() => createRoster(catalogue, 2000));
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(() => needsSetup(catalogue, roster));
  const [registry, setRegistry] = useState<CatalogueDescriptor[]>([bundled]);
  const [activeDescriptorId, setActiveDescriptorId] = useState(bundled.id);
  const [factionError, setFactionError] = useState<string | undefined>(undefined);
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);
  const hiddenIds = useMemo(() => hiddenEntryIds(roster, catalogue), [roster, catalogue]);
  const hiddenSelIds = useMemo(() => hiddenSelectionIds(roster, catalogue), [roster, catalogue]);

  // Discover the catalogue library from the local manifest on mount. Any failure
  // degrades to bundled-only (loadRegistry never throws).
  useEffect(() => {
    const fetchFn = typeof fetch === "function" ? fetch.bind(globalThis) : undefined;
    if (!fetchFn) return;
    const base = import.meta.env.BASE_URL;
    // Only replace the bundled-only default when the manifest actually adds factions,
    // so a missing/empty manifest is a no-op (no needless re-render).
    void loadRegistry(bundled, fetchFn, `${base}catalogues.json`).then((reg) => {
      if (reg.length > 1) setRegistry(reg);
    });
  }, []);

  // Shared swap of the active catalogue: fresh roster, cleared selection, wizard
  // re-evaluated. Used by both file-import and faction switching.
  const applyCatalogue = (next: IrCatalogue, descriptorId: string) => {
    const nextRoster = createRoster(next, 2000);
    setCatalogue(next);
    setRoster(nextRoster);
    setActiveDescriptorId(descriptorId);
    setSelectedUnitId(undefined);
    setPickerOpen(false);
    setWizardStep(0);
    setWizardOpen(needsSetup(next, nextRoster));
  };

  const loadIr = async (file: File) => {
    applyCatalogue(loadCatalogue(JSON.parse(await file.text())), "imported");
  };

  const onSelectFaction = (descriptorId: string) => {
    const desc = registry.find((d) => d.id === descriptorId);
    if (!desc) return;
    setFactionError(undefined);
    const fetchFn = typeof fetch === "function" ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch);
    void loadCatalogueFor(desc, fetchFn, import.meta.env.BASE_URL)
      .then((next) => applyCatalogue(next, desc.id))
      .catch(() => setFactionError(`Couldn't load ${desc.name}`));
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
          registry={registry} activeDescriptorId={activeDescriptorId}
          onSelectFaction={onSelectFaction} factionError={factionError}
          onSetPoints={(n) => setRoster((r) => setPointsLimit(r, n))}
          onSetDetachment={(id) => setRoster((r) => setDetachment(r, id, catalogue))}
          onClose={() => setWizardOpen(false)} />
      )}
    </main>
  );
}
