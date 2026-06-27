"use client";

import { useEffect } from "react";

const SIZES: Record<string, string> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
  wide: "max-w-5xl",
  xwide: "max-w-6xl",
};

export default function Modal({
  open, onClose, title, children, wide = false, size,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  size?: "md" | "lg" | "xl" | "wide" | "xwide";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`animate-scale-in flex max-h-[90vh] w-full flex-col ${SIZES[size ?? (wide ? "wide" : "md")]} rounded-3xl bg-slate-50 shadow-2xl ring-1 ring-black/5 dark:bg-[#101116] dark:ring-white/10`}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="rounded-full px-2 text-xl leading-none text-slate-400 transition hover:text-slate-700 dark:hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6 ${title !== undefined ? "pt-4" : "pt-5 sm:pt-6"}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
