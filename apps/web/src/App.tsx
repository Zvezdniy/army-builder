import { useEffect, useMemo, useRef, useState } from "react";
import type { IrCatalogue, Roster } from "@muster/domain";
import { loadCatalogue } from "@muster/domain";
import { createRoster, addUnit, addOption, toggleGroupMember, setGroupMemberCount, setCount, remove,
  toggleDetachment, setPointsLimit, availableDetachments, selectedDetachment,
  detachmentSelectionIds, attachLeader, detachLeader, toggleWarlord,
  upsertActive, updateEntry, activeEntry, setActive, renameEntry, duplicateEntry, deleteEntry, toEnvelope, fromEnvelope } from "@muster/roster";
import { evaluate, hiddenEntryIds, hiddenSelectionIds } from "@muster/engine-eval";
import { RosterList } from "./components/RosterList";
import { UnitDetail } from "./components/UnitDetail";
import { AddUnitPicker } from "./components/AddUnitPicker";
import { SetupWizard, type SetupStep } from "./components/SetupWizard";
import { SetupBar } from "./components/SetupBar";
import { DetachmentPanel } from "./components/DetachmentPanel";
import { StratagemPanel } from "./components/StratagemPanel";
import { LegalityPanel } from "./components/LegalityPanel";
import { MyArmies } from "./components/MyArmies";
import { ExportModal } from "./components/ExportModal";
import { ThemeToggle } from "./components/ThemeToggle";
import { bundledDescriptor, loadRegistry, loadCatalogueFor, normalizeBase, type CatalogueDescriptor } from "./registry/catalogueRegistry";
import { useRosterLibrary } from "./registry/rosterLibrary";
import { loadStratagemLibrary, loadStratagemsFor, slugForDescriptor } from "./registry/stratagemRegistry";
import type { StratagemManifest, StratagemFile } from "@muster/domain";
import mini40k from "./mini40k.ir.json";

// Where catalogue data is served from. Defaults to the app's own origin (Vite's
// BASE_URL); set VITE_CATALOGUES_BASE to an absolute URL (e.g. a GitHub Pages host)
// to fetch a hosted, auto-updated library — decoupling data refreshes from app deploys.
const CATALOGUES_BASE = normalizeBase(import.meta.env.VITE_CATALOGUES_BASE || import.meta.env.BASE_URL);

// The setup wizard auto-opens for a fresh army when the catalogue models detachments
// but none is chosen yet (matched-play requires a detachment).
function needsSetup(catalogue: IrCatalogue, roster: ReturnType<typeof createRoster>): boolean {
  return availableDetachments(catalogue).length > 0 && selectedDetachment(roster, catalogue) === undefined;
}

// The bundled fixture is always the first, always-available faction. Built once.
// mini40k is a 10e-shaped fixture.
const bundled = bundledDescriptor(mini40k, { id: "10e", name: "10th Edition" });

// A single fetch binding for registry/catalogue loading; undefined in environments
// without a global fetch (both call sites handle that uniformly).
const boundFetch: typeof fetch | undefined = typeof fetch === "function" ? fetch.bind(globalThis) : undefined;

export function App() {
  const [catalogue, setCatalogue] = useState<IrCatalogue>(() => loadCatalogue(mini40k));
  const [roster, setRoster] = useState(() => createRoster(catalogue, 2000));
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<SetupStep>("points");
  const [wizardOpen, setWizardOpen] = useState(() => needsSetup(catalogue, roster));
  const [registry, setRegistry] = useState<CatalogueDescriptor[]>([bundled]);
  const [activeDescriptorId, setActiveDescriptorId] = useState(bundled.id);
  const [factionError, setFactionError] = useState<string | undefined>(undefined);
  const [stratagemManifest, setStratagemManifest] = useState<StratagemManifest | undefined>(undefined);
  const [stratagemData, setStratagemData] = useState<{ core: StratagemFile; faction?: StratagemFile } | undefined>(undefined);
  const { library, setLibrary } = useRosterLibrary();
  const [myArmiesOpen, setMyArmiesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [registryLoaded, setRegistryLoaded] = useState(false);
  // The pre-session library snapshot (whatever was in localStorage at mount), frozen
  // via a ref so a same-session explicit action (e.g. "+ New army", which writes to
  // the live `library` state before restore has settled) can never be mistaken by
  // restore for "the last-edited roster to restore" and clobber it back.
  const initialLibraryRef = useRef(library);
  const result = useMemo(() => {
    const r = evaluate(roster, catalogue);
    // The detachment is an army-level choice made in the wizard, not a roster unit,
    // so drop the "not available in the current army configuration" warning on it and
    // its subtree — its own availability gate is not a unit problem.
    const detSel = detachmentSelectionIds(roster, catalogue);
    if (detSel.size === 0) return r;
    const issues = r.issues.filter(
      (i) => !(i.code === "selection.hidden" && i.selectionId !== undefined && detSel.has(i.selectionId)),
    );
    return issues.length === r.issues.length ? r : { ...r, issues };
  }, [roster, catalogue]);
  const hiddenIds = useMemo(() => hiddenEntryIds(roster, catalogue), [roster, catalogue]);
  const hiddenSelIds = useMemo(() => hiddenSelectionIds(roster, catalogue), [roster, catalogue]);

  // Discover the catalogue library from the local manifest on mount. Any failure
  // degrades to bundled-only (loadRegistry never throws).
  useEffect(() => {
    if (!boundFetch) { setRegistryLoaded(true); return; }
    void loadRegistry(bundled, boundFetch, `${CATALOGUES_BASE}catalogues.json`)
      .then((reg) => { if (reg.length > 1) setRegistry(reg); })
      .finally(() => setRegistryLoaded(true));
  }, []);

  // Auto-save the active roster's content once restore has settled. update-only:
  // a roster the library doesn't own (a post-failed-restore default, or a
  // just-deleted entry) is left untouched.
  useEffect(() => {
    if (!restored) return;
    setLibrary((lib) => updateEntry(lib, roster, Date.now()));
  }, [roster, restored]);

  // Restore the last-edited roster once the manifest load has settled (success or
  // failure). Runs exactly once — the restored guard also prevents the re-entrancy
  // via autosave→setLibrary.
  useEffect(() => {
    if (restored || !registryLoaded) return;
    const entry = activeEntry(initialLibraryRef.current);
    if (!entry) { setRestored(true); return; }
    const desc = registry.find((d) => d.edition === entry.edition && d.catalogueId === entry.catalogueId);
    if (!desc) { setFactionError(`Couldn't load ${entry.catalogueName}`); setRestored(true); return; }
    void loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE)
      .then((next) => { applyCatalogueWithRoster(next, desc.id, entry.roster); })
      .catch(() => setFactionError(`Couldn't load ${entry.catalogueName}`))
      .finally(() => setRestored(true));
  }, [registryLoaded, restored]);

  // Discover the stratagem library from the same base as the catalogue library.
  // Any failure leaves the manifest undefined → the panel simply never appears.
  useEffect(() => {
    void loadStratagemLibrary(boundFetch, CATALOGUES_BASE).then(setStratagemManifest);
  }, []);

  // Load Core + the active faction's stratagems whenever the faction or the manifest
  // changes. A bundled/imported descriptor has no slug → core-only; any failure → undefined.
  useEffect(() => {
    if (!stratagemManifest) { setStratagemData(undefined); return; }
    const desc = registry.find((d) => d.id === activeDescriptorId);
    const slug = desc ? slugForDescriptor(desc) : undefined;
    void loadStratagemsFor(boundFetch, CATALOGUES_BASE, stratagemManifest, slug).then(setStratagemData);
  }, [activeDescriptorId, stratagemManifest, registry]);

  // Install a catalogue and a specific roster (used by restore/open/import).
  const applyCatalogueWithRoster = (next: IrCatalogue, descriptorId: string, nextRoster: Roster) => {
    setCatalogue(next);
    setRoster(nextRoster);
    setActiveDescriptorId(descriptorId);
    setSelectedUnitId(undefined);
    setPickerOpen(false);
    setWizardStep("points");
    setWizardOpen(needsSetup(next, nextRoster));
  };
  // Swap to a fresh roster (faction switch / new army). Adds it to the library only
  // when the descriptor is a real known faction, so it can be restored later —
  // imported ad-hoc IR (descriptorId "imported", no registry entry) stays session-only.
  const applyCatalogue = (next: IrCatalogue, descriptorId: string) => {
    const nextRoster = createRoster(next, 2000);
    applyCatalogueWithRoster(next, descriptorId, nextRoster);
    const desc = registry.find((d) => d.id === descriptorId);
    if (desc) setLibrary((lib) => upsertActive(lib, nextRoster, { edition: desc.edition, catalogueId: desc.catalogueId, catalogueName: desc.name }, Date.now()));
  };

  const loadIr = async (file: File) => {
    applyCatalogue(loadCatalogue(JSON.parse(await file.text())), "imported");
  };

  const onSelectFaction = (descriptorId: string) => {
    const desc = registry.find((d) => d.id === descriptorId);
    if (!desc) return;
    setFactionError(undefined);
    // boundFetch may be undefined; loadCatalogueFor still resolves bundled sources and
    // rejects a remote one without fetch → caught below as a load error.
    void loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE)
      .then((next) => applyCatalogue(next, desc.id))
      .catch(() => setFactionError(`Couldn't load ${desc.name}`));
  };

  const openWizardAt = (step: SetupStep) => { setWizardStep(step); setWizardOpen(true); };

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

  const openFromLibrary = (id: string) => {
    const entry = library.entries.find((e) => e.id === id);
    if (!entry) return;
    setLibrary((lib) => ({ ...lib, activeId: id }));
    const desc = registry.find((d) => d.edition === entry.edition && d.catalogueId === entry.catalogueId);
    if (!desc) { setFactionError(`Couldn't load ${entry.catalogueName}`); return; }
    void loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE)
      .then((next) => { applyCatalogueWithRoster(next, desc.id, entry.roster); setMyArmiesOpen(false); })
      .catch(() => setFactionError(`Couldn't load ${entry.catalogueName}`));
  };

  const exportRoster = (id: string) => {
    const entry = library.entries.find((e) => e.id === id);
    if (!entry) return;
    const env = toEnvelope(entry.roster, entry.edition, entry.catalogueId);
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entry.name.replace(/[^\w.-]+/g, "_") || "roster"}.muster.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importRoster = async (file: File) => {
    try {
      const { roster: imported, edition, catalogueId } = fromEnvelope(JSON.parse(await file.text()));
      // Avoid clobbering an existing entry with the same id.
      const id = library.entries.some((e) => e.id === imported.id) ? crypto.randomUUID() : imported.id;
      const desc = registry.find((d) => d.edition === edition && d.catalogueId === catalogueId);
      if (!desc) { setFactionError(`Couldn't load the imported army's faction`); return; }
      const roster: Roster = { ...imported, id };
      const next = await loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE);
      setLibrary((lib) => upsertActive(lib, roster, { edition: desc.edition, catalogueId: desc.catalogueId, catalogueName: desc.name }, Date.now()));
      applyCatalogueWithRoster(next, desc.id, roster);
      setMyArmiesOpen(false);
    } catch {
      setFactionError("That file isn't a valid Muster roster");
    }
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {/* The faction half is dropped on phones (.h1-faction) — the Faction chip
            below already names it, so the title reads just "Muster" and stops
            dwarfing the header controls. */}
        <h1 style={{ margin: 0 }}>Muster<span className="h1-faction"> — {catalogue.name}</span></h1>
        <div className="header-actions">
          <ThemeToggle />
          <button onClick={() => setMyArmiesOpen(true)}>My armies</button>
          {/* Native file input is visually hidden; the label is the tappable button
              (the UA's own "Choose file" widget is locale-dependent and untidy). */}
          <label className="file-btn">
            Load IR
            <input type="file" accept="application/json" className="vh"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadIr(f); }} />
          </label>
        </div>
      </header>
      {factionError && !wizardOpen && (
        <p role="alert" style={{ color: "#c0392b", margin: "8px 0" }}>{factionError}</p>
      )}
      <SetupBar catalogue={catalogue} roster={roster} onEdit={openWizardAt}
        registry={registry} activeDescriptorId={activeDescriptorId} />
      <DetachmentPanel catalogue={catalogue} roster={roster}
        onSelectUnit={setSelectedUnitId}
        onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))} />
      <StratagemPanel data={stratagemData} roster={roster} catalogue={catalogue} />
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
        onEditPoints={() => openWizardAt("points")}
        onFocusUnit={setSelectedUnitId}
      />
      <div className="builder" data-view={selectedUnitId ? "detail" : "list"}>
        <RosterList roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onSelect={setSelectedUnitId} onOpenPicker={() => setPickerOpen(true)}
          onOpenExport={() => setExportOpen(true)} hiddenIds={hiddenSelIds} />
        <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onBack={() => setSelectedUnitId(undefined)}
          onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid, catalogue))}
          onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))}
          onSetGroupMemberCount={(pid, group, eid, count) => setRoster((r) => setGroupMemberCount(r, pid, group, eid, count, catalogue))}
          onRemove={handleRemove}
          onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))}
          onAttachLeader={(lid, bid) => setRoster((r) => attachLeader(r, catalogue, lid, bid))}
          onDetachLeader={(lid) => setRoster((r) => detachLeader(r, lid))}
          onToggleWarlord={(id) => setRoster((r) => toggleWarlord(r, id))} />
      </div>
      {pickerOpen && (
        <AddUnitPicker catalogue={catalogue} hiddenIds={hiddenIds} onAdd={addAndSelect} onClose={() => setPickerOpen(false)} />
      )}
      {wizardOpen && (
        <SetupWizard catalogue={catalogue} roster={roster} initialStep={wizardStep}
          registry={registry} activeDescriptorId={activeDescriptorId}
          onSelectFaction={onSelectFaction} factionError={factionError}
          onSetPoints={(n) => setRoster((r) => setPointsLimit(r, n))}
          onToggleDetachment={(id) => setRoster((r) => toggleDetachment(r, id, catalogue))}
          onClose={() => setWizardOpen(false)} />
      )}
      {exportOpen && (
        // edition/catalogueId identify the roster's faction for the re-importable
        // .json envelope; a known faction supplies both, an imported ad-hoc IR falls
        // back to the loaded catalogue's own id (text formats never need them).
        <ExportModal roster={roster} catalogue={catalogue}
          edition={registry.find((d) => d.id === activeDescriptorId)?.edition ?? "10e"}
          catalogueId={registry.find((d) => d.id === activeDescriptorId)?.catalogueId ?? catalogue.id}
          onClose={() => setExportOpen(false)} />
      )}
      {myArmiesOpen && (
        <MyArmies
          library={library}
          onOpen={openFromLibrary}
          onRename={(id, name) => setLibrary((lib) => renameEntry(lib, id, name, Date.now()))}
          onDuplicate={(id) => setLibrary((lib) => duplicateEntry(lib, id, crypto.randomUUID(), Date.now()))}
          onDelete={(id) => setLibrary((lib) => deleteEntry(lib, id))}
          onExport={exportRoster}
          onImport={(f) => void importRoster(f)}
          onNew={() => { setMyArmiesOpen(false); applyCatalogue(loadCatalogue(mini40k), bundled.id); setWizardOpen(true); }}
          onClose={() => setMyArmiesOpen(false)} />
      )}
    </main>
  );
}
