"use client";

import { useEffect, useState } from "react";
import type { ToastDetail } from "@/lib/toast";

export default function Toaster() {
  const [items, setItems] = useState<ToastDetail[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const d = (e as CustomEvent<ToastDetail>).detail;
      setItems((prev) => [...prev, d]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== d.id));
      }, 3500);
    }
    window.addEventListener("app-toast", onToast);
    return () => window.removeEventListener("app-toast", onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-toast-in pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-xl ring-1 backdrop-blur ${
            t.kind === "error"
              ? "bg-red-50/95 text-red-700 ring-red-200 dark:bg-red-950/70 dark:text-red-200 dark:ring-red-900/50"
              : t.kind === "info"
              ? "bg-white/95 text-slate-700 ring-slate-200 dark:bg-[#1b1d22]/95 dark:text-neutral-200 dark:ring-white/10"
              : "bg-emerald-50/95 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200 dark:ring-emerald-900/50"
          }`}
        >
          <span className="text-base leading-none">
            {t.kind === "error" ? "⚠️" : t.kind === "info" ? "ℹ️" : "✓"}
          </span>
          <span className="flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
