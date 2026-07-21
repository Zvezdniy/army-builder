import "@testing-library/jest-dom";

// This jsdom build exposes a `localStorage` without the full Storage API
// (`clear`/`length`/`key` are missing), which the roster-library persistence
// tests rely on. Install a minimal, spec-shaped in-memory Storage when `clear`
// is absent so tests exercise the real adapter against a working store.
if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  const store = new Map<string, string>();
  const mock: Storage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mock, configurable: true, writable: true });
}
