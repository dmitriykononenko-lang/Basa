"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney } from "@/lib/format";
import { VAT_LABELS, type CatalogItem } from "@/lib/invoices";

// Автодополнение наименования позиции из справочника ранее выставленных товаров.
// Кастомная выпадашка (не нативный datalist) в стиле приложения; рендер порталом
// в <body> с привязкой к полю, чтобы не обрезалась overflow-контейнером модалки.
export default function ItemNameAutocomplete({
  value,
  onChange,
  onPick,
  catalog,
  className = "",
  placeholder,
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (item: CatalogItem) => void;
  catalog: CatalogItem[];
  className?: string;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hi, setHi] = useState(0);

  useEffect(() => setMounted(true), []);

  const q = value.trim().toLowerCase();
  const matches = (q ? catalog.filter((c) => c.name.toLowerCase().includes(q)) : catalog).slice(0, 50);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  function pick(item: CatalogItem) {
    onPick(item);
    setOpen(false);
  }

  const showList = mounted && open && rect && matches.length > 0;

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => catalog.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(matches[hi] ?? matches[0]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className={className}
        placeholder={placeholder}
        autoComplete="off"
      />
      {showList && createPortal(
        <div
          className="fixed z-[70] max-h-72 overflow-auto rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#1b1d22] dark:ring-white/5"
          style={{ left: rect!.left, top: rect!.top, width: rect!.width }}
          // Не даём полю потерять фокус до обработки клика.
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((c, idx) => (
            <button
              key={c.name}
              type="button"
              onClick={() => pick(c)}
              onMouseEnter={() => setHi(idx)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                idx === hi ? "bg-brand/[0.07] dark:bg-brand/10" : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-neutral-100">{c.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-neutral-500">
                {formatMoney(c.price, "RUB")}
                <span className="ml-1 text-slate-300 dark:text-neutral-600">· {VAT_LABELS[c.vat_rate]}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
