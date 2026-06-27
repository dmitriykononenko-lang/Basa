"use client";

import { useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EmptyState from "@/components/EmptyState";

export type NotificationRow = {
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

const TYPE_LABELS: Record<string, string> = {
  cash_gap: "Кассовый разрыв",
  debt_overdue: "Просрочки",
  budget_over: "Бюджеты",
  transfer_short: "Нехватка на счёте",
  training_due: "Обучение",
};

export default function NotificationList({ initial }: { initial: NotificationRow[] }) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [items, setItems] = useState<NotificationRow[]>(initial);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState<string>("all");

  const types = useMemo(() => {
    const set = new Set(items.map((n) => n.type));
    return [...set];
  }, [items]);

  const filtered = items.filter(
    (n) => (!unreadOnly || !n.read_at) && (type === "all" || n.type === type),
  );
  const unread = items.filter((n) => !n.read_at).length;

  const markRead = async (id: string) => {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: stamp } : n)));
    await supabase.from("notifications").update({ read_at: stamp }).eq("id", id);
  };

  const markAll = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    await supabase.from("notifications").update({ read_at: stamp }).in("id", ids);
  };

  const hide = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };

  const openItem = async (n: NotificationRow) => {
    if (!n.read_at) await markRead(n.id);
    if (n.link) router.push(n.link);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill active={!unreadOnly} onClick={() => setUnreadOnly(false)}>Все</Pill>
        <Pill active={unreadOnly} onClick={() => setUnreadOnly(true)}>
          Непрочитанные{unread > 0 ? ` · ${unread}` : ""}
        </Pill>
        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
        <Pill active={type === "all"} onClick={() => setType("all")}>Все типы</Pill>
        {types.map((t) => (
          <Pill key={t} active={type === t} onClick={() => setType(t)}>
            {TYPE_LABELS[t] ?? t}
          </Pill>
        ))}
        {unread > 0 && (
          <button onClick={markAll} className="ml-auto text-sm font-medium text-brand hover:underline">
            Прочитать всё
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🔔" title="Нет уведомлений" description="Здесь появятся важные события: кассовые разрывы, просрочки, дедлайны обучения." />
      ) : (
        <ul className="surface divide-y divide-slate-100 overflow-hidden rounded-3xl dark:divide-white/[0.06]">
          {filtered.map((n) => (
            <li
              key={n.id}
              className={`group flex gap-3 px-5 py-4 transition hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
                n.read_at ? "" : "bg-brand/[0.03] dark:bg-brand/[0.06]"
              }`}
            >
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.severity] ?? "bg-slate-400"}`} />
              <button onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-neutral-100">{n.title}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {TYPE_LABELS[n.type] ?? n.type}
                  </span>
                </div>
                {n.body && <div className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">{n.body}</div>}
                <div className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">{timeAgo(n.created_at)}</div>
              </button>
              <div className="flex shrink-0 items-start gap-2">
                {!n.read_at && (
                  <button onClick={() => markRead(n.id)} className="text-[11px] text-brand opacity-0 transition hover:underline group-hover:opacity-100">
                    прочитано
                  </button>
                )}
                <button
                  onClick={() => hide(n.id)}
                  aria-label="Скрыть"
                  className="h-5 w-5 rounded text-slate-300 opacity-0 transition hover:text-slate-500 group-hover:opacity-100 dark:text-neutral-600"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-brand bg-brand/5 text-brand"
          : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-neutral-400"
      }`}
    >
      {children}
    </button>
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
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}
