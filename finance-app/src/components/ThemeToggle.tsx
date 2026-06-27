"use client";

import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "./icons";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function apply(next: boolean) {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 dark:bg-neutral-800">
      <button
        type="button"
        aria-label="Светлая тема"
        onClick={() => apply(false)}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
          !dark
            ? "bg-white text-accent shadow-sm"
            : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        <IconSun />
      </button>
      <button
        type="button"
        aria-label="Тёмная тема"
        onClick={() => apply(true)}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
          dark
            ? "bg-neutral-900 text-white shadow-sm"
            : "text-slate-400 hover:text-slate-600"
        }`}
      >
        <IconMoon />
      </button>
    </div>
  );
}
