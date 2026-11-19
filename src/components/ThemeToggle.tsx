"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "zodiac-theme";
type Theme = "dark" | "light";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable in private mode; the in-memory theme still applies.
    }
  };

  return (
    <button type="button" className="btn px-2 py-1.5" onClick={toggle} aria-label="切换主题">
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      <span className="text-[11px]">{theme === "dark" ? "浅色" : "深色"}</span>
    </button>
  );
}
