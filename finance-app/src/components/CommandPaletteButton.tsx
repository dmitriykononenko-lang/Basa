"use client";

import { IconSearch } from "@/components/icons";

export default function CommandPaletteButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
      className="hidden items-center gap-2 rounded-full bg-slate-100 py-1.5 pl-3 pr-2 text-sm text-slate-400 transition hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 sm:flex"
      aria-label="Поиск и навигация"
    >
      <IconSearch className="h-4 w-4" />
      <span className="text-slate-500 dark:text-neutral-400">Поиск</span>
      <kbd className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm dark:bg-white/[0.08] dark:text-neutral-300">⌘K</kbd>
    </button>
  );
}
