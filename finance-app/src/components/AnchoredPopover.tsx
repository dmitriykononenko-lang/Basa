"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Поповер, привязанный к триггеру и отрисованный порталом в <body> с fixed-
// позиционированием. Так он не обрезается родителями с overflow-hidden/auto и не
// зажимается их z-index/stacking-контекстом. Якорится по правому краю триггера
// (как absolute right-0). Закрывается по клику вне (клик по фоновому слою).
export default function AnchoredPopover<T extends HTMLElement>({
  anchorRef,
  onClose,
  children,
  className = "",
}: {
  anchorRef: RefObject<T | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function place() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    place();
    // Держим привязку при прокрутке/ресайзе (capture — ловим скролл любых предков).
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef]);

  if (!mounted || !pos) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className={`fixed z-[61] ${className}`} style={{ top: pos.top, right: pos.right }}>
        {children}
      </div>
    </>,
    document.body,
  );
}
