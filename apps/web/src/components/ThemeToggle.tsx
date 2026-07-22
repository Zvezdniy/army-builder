import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "muster-theme";

// The effective theme at load: an explicit saved choice wins; otherwise follow the OS.
// Guards for environments without localStorage/matchMedia (SSR, older test runners).
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* localStorage unavailable */ }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** A one-tap light/dark theme switch. Persists the choice to localStorage and stamps
 *  data-theme on <html>; the CSS makes an explicit choice override the OS preference.
 *  The pre-paint script in index.html applies the saved value before first render. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button className="theme-toggle" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}>
      {theme === "dark" ? "☀" : "🌙"}
    </button>
  );
}
