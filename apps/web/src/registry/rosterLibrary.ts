import { useEffect, useRef, useState } from "react";
import type { RosterLibrary } from "@muster/domain";
import { parseLibrary, emptyLibrary } from "@muster/roster";

export const STORAGE_KEY = "muster:library:v1";

/** Read + validate the stored library. Any storage/JSON error degrades to an
 *  empty library — persistence must never crash the app. */
export function loadLibrary(): RosterLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyLibrary();
    return parseLibrary(JSON.parse(raw));
  } catch {
    return emptyLibrary();
  }
}

/** Best-effort write; swallow quota/security errors. */
export function saveLibrary(lib: RosterLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    /* ignore */
  }
}

/** Library state persisted to localStorage, debounced so keystroke-level roster
 *  edits coalesce into one write. */
export function useRosterLibrary(): {
  library: RosterLibrary;
  setLibrary: (updater: (lib: RosterLibrary) => RosterLibrary) => void;
} {
  const [library, setLibrary] = useState<RosterLibrary>(() => loadLibrary());
  // Keep a ref to the latest library synced during render (not inside a
  // setState updater, which must stay pure).
  const latest = useRef(library);
  latest.current = library;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debounced write on change: keystroke-level roster edits coalesce into one.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveLibrary(latest.current), 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [library]);

  // Flush the pending write on unmount AND on page hide (tab close / navigation),
  // so an edit made inside the debounce window is not lost. localStorage writes
  // are synchronous, so a pagehide flush completes before the page unloads.
  useEffect(() => {
    const flush = () => saveLibrary(latest.current);
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  return { library, setLibrary };
}
