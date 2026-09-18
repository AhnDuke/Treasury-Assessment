"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "ttb-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // private browsing / blocked storage - fall back to system preference
    }
    // Reading localStorage/matchMedia can't happen during SSR or the
    // server-matching hydration pass, so this necessarily runs once, post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored === "light" || stored === "dark" ? stored : systemTheme());
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggle() {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // convenience feature only - fine if it doesn't persist
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex size-9 items-center justify-center border border-border text-ink-muted transition-colors hover:text-ink"
    >
      {theme === "dark" ? (
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
