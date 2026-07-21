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
  const [library, setLibraryState] = useState<RosterLibrary>(() => loadLibrary());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(library);

  const setLibrary = (updater: (lib: RosterLibrary) => RosterLibrary) => {
    setLibraryState((prev) => {
      const next = updater(prev);
      latest.current = next;
      return next;
    });
  };

  useEffect(() => {
    latest.current = library;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveLibrary(latest.current), 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [library]);

  return { library, setLibrary };
}
