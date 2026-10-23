"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Check saved theme or system preference
    const saved =
      typeof localStorage !== "undefined"
        ? (localStorage.getItem("cl_theme") as "light" | "dark" | null)
        : null;
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      const prefersDark =
        typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : false;
      const initial = prefersDark ? "dark" : "light";
      setTheme(initial);
      document.documentElement.setAttribute("data-theme", initial);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("cl_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <button
      type="button"
      className="cl-theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span className="cl-theme-icon">{theme === "light" ? "🌙" : "☀️"}</span>
      <span className="cl-theme-label">{theme === "light" ? "Dark" : "Light"}</span>
    </button>
  );
}
