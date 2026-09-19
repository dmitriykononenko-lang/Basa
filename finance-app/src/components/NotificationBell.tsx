"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { IconBell } from "@/components/icons";

type Notification = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  link: string;
  created_at: string;
  read_at: string | null;
};

const DOT: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-brand",
};

export default function NotificationBell() {
  const router = useRouter();
  const supabase = useRef(createClient());
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.current
      .from("notifications")
      .select("id, type, severity, title, body, link, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setItems((data ?? []) as Notification[]);
  }, []);

  useEffect(() => {
    load();
    // лёгкий поллинг, чтобы колокольчик обновлялся без перезагрузки
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  // закрытие по клику вне
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    await supabase.current.from("notifications").update({ read_at: stamp }).in("id", ids);
  };

  const hide = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.current.from("notifications").delete().eq("id", id);
  };

  const openItem = async (n: Notification) => {
    if (!n.read_at) {
      const stamp = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: stamp } : x)));
      await supabase.current.from("notifications").update({ read_at: stamp }).eq("id", n.id);
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 dark:hover:bg-neutral-800"
        aria-label="Уведомления"
      >
        <IconBell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-[340px] max-w-[calc(100vw-2rem)] animate-scale-in rounded-2xl border border-slate-100 bg-white shadow-xl dark:border-white/[0.08] dark:bg-[#15171c]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.07]">
            <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Уведомления</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-brand hover:underline">
                Прочитать всё
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400 dark:text-neutral-500">
                Пока нет уведомлений
              </div>
            ) : (
              <ul className="divide-y divide-slate-50 dark:divide-white/[0.05]">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={`group flex gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
                      n.read_at ? "" : "bg-brand/[0.03] dark:bg-brand/[0.06]"
                    }`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.severity] ?? "bg-slate-400"}`} />
                    <button onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{n.title}</div>
                      {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-neutral-400">{n.body}</div>}
                      <div className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">{timeAgo(n.created_at)}</div>
                    </button>
                    <button
                      onClick={() => hide(n.id)}
                      aria-label="Скрыть"
                      className="h-5 w-5 shrink-0 rounded text-slate-300 opacity-0 transition hover:text-slate-500 group-hover:opacity-100 dark:text-neutral-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-4 py-2.5 text-center text-xs font-medium text-brand transition hover:bg-slate-50 dark:border-white/[0.07] dark:hover:bg-white/[0.03]"
          >
            Все уведомления →
          </Link>
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}
