"use client";

import { useState } from "react";

export default function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-slate-400 dark:text-neutral-500">{label}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="truncate text-right font-medium text-slate-700 transition hover:text-brand dark:text-neutral-200"
        title="Скопировать"
      >
        {copied ? "Скопировано ✓" : value}
      </button>
    </div>
  );
}
