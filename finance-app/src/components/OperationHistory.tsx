"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string };
type Category = { id: string; name: string };

type Change = { field: string; old: unknown; new: unknown };
type Row = {
  id: string;
  action: "create" | "update";
  changed_by: string | null;
  changed_at: string;
  changes: Change[];
  source: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  amount: "Сумма",
  currency: "Валюта",
  type: "Тип",
  account_id: "Счёт",
  transfer_account_id: "Счёт зачисления",
  category_id: "Статья",
  counterparty_id: "Контрагент",
  project_id: "Проект",
  occurred_on: "Дата",
  accrual_date: "Дата начисления",
  note: "Описание",
  status: "Статус",
};

const TYPE_LABELS: Record<string, string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
};
const STATUS_LABELS: Record<string, string> = {
  actual: "Фактическая",
  planned: "Плановая",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OperationHistory({
  transactionId,
  currency,
  accounts,
  categories,
  counterparties,
  projects,
}: {
  transactionId: string;
  currency: string;
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("transaction_history")
        .select("id, action, changed_by, changed_at, changes, source")
        .eq("transaction_id", transactionId)
        .order("changed_at", { ascending: false });
      const list = (data ?? []) as Row[];
      const ids = [...new Set(list.map((r) => r.changed_by).filter(Boolean))] as string[];
      let nameMap: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        nameMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name ?? ""]));
      }
      if (cancelled) return;
      setRows(list);
      setNames(nameMap);
      setLoaded(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, transactionId]);

  function resolve(field: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    switch (field) {
      case "amount":
        return formatMoney(Number(value), currency);
      case "type":
        return TYPE_LABELS[String(value)] ?? String(value);
      case "status":
        return STATUS_LABELS[String(value)] ?? String(value);
      case "account_id":
      case "transfer_account_id":
        return accounts.find((a) => a.id === value)?.name ?? "— удалён —";
      case "category_id":
        return categories.find((c) => c.id === value)?.name ?? "— удалена —";
      case "counterparty_id":
        return counterparties.find((c) => c.id === value)?.name ?? "— удалён —";
      case "project_id":
        return projects.find((p) => p.id === value)?.name ?? "— удалён —";
      case "occurred_on":
      case "accrual_date":
        return formatDate(String(value));
      default:
        return String(value);
    }
  }

  function actor(r: Row): string {
    if (r.changed_by && names[r.changed_by]) return names[r.changed_by];
    if (r.changed_by) return "Участник команды";
    if (r.source && r.source !== "manual") return "Импорт из банка";
    return "Система";
  }

  return (
    <div className="mt-5 border-t border-slate-200/70 pt-4 dark:border-white/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 transition hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        История изменений
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-3">
          {loading && <p className="text-xs text-slate-400 dark:text-neutral-500">Загрузка…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-neutral-500">Изменений пока нет.</p>
          )}
          {!loading && rows.length > 0 && (
            <ol className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="flex gap-3 text-sm">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      r.action === "create"
                        ? "bg-emerald-400 dark:bg-emerald-500"
                        : "bg-slate-300 dark:bg-neutral-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-slate-700 dark:text-neutral-200">{actor(r)}</span>
                      <span className="text-xs text-slate-400 dark:text-neutral-500">{formatTime(r.changed_at)}</span>
                    </div>
                    {r.action === "create" ? (
                      <p className="text-xs text-slate-500 dark:text-neutral-400">Операция создана</p>
                    ) : (
                      <ul className="mt-0.5 space-y-0.5">
                        {r.changes.map((c, i) => (
                          <li key={i} className="text-xs text-slate-500 dark:text-neutral-400">
                            <span className="text-slate-600 dark:text-neutral-300">{FIELD_LABELS[c.field] ?? c.field}:</span>{" "}
                            <span className="text-slate-400 line-through dark:text-neutral-600">{resolve(c.field, c.old)}</span>{" "}
                            <span className="text-slate-400 dark:text-neutral-500">→</span>{" "}
                            <span className="text-slate-700 dark:text-neutral-200">{resolve(c.field, c.new)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
