"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string };
type Category = { id: string; name: string; kind: "income" | "expense" };

// Простой парсер CSV-строки с учётом кавычек
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDate(s: string): string | null {
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export default function ImportTransactions({
  teamId,
  userId,
  accounts,
  categories,
  counterparties,
  projects,
}: {
  teamId: string;
  userId: string;
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
  const cpByName = new Map(counterparties.map((c) => [c.name.toLowerCase(), c.id]));
  const prByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
  const catByKey = new Map(categories.map((c) => [c.kind + "|" + c.name.toLowerCase(), c.id]));

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("Файл пуст или без данных");

      const delim = lines[0].includes(";") ? ";" : ",";
      const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
      const col = (name: string) => header.findIndex((h) => h.includes(name));
      const ci = {
        date: col("дата"),
        type: col("тип"),
        category: col("категори"),
        counterparty: col("контрагент"),
        project: col("проект"),
        account: col("счёт") >= 0 ? col("счёт") : col("счет"),
        amount: col("сумма"),
        currency: col("валюта"),
        note: col("коммент"),
      };
      if (ci.date < 0 || ci.amount < 0 || ci.account < 0 || ci.type < 0) {
        throw new Error("Нужны колонки: Дата, Тип, Сумма, Счёт");
      }

      const inserts: Record<string, unknown>[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const r = splitCsvLine(lines[i], delim);
        const rawType = (r[ci.type] ?? "").toLowerCase();
        const type = rawType.startsWith("дох") || rawType === "income"
          ? "income"
          : rawType.startsWith("рас") || rawType === "expense"
            ? "expense"
            : null;
        if (!type) {
          errors.push(`Строка ${i + 1}: тип «${r[ci.type]}» пропущен (переводы не импортируются)`);
          continue;
        }
        const date = parseDate(r[ci.date] ?? "");
        if (!date) {
          errors.push(`Строка ${i + 1}: некорректная дата`);
          continue;
        }
        const account = accByName.get((r[ci.account] ?? "").toLowerCase());
        if (!account) {
          errors.push(`Строка ${i + 1}: счёт «${r[ci.account]}» не найден`);
          continue;
        }
        const amount = parseMoney(r[ci.amount] ?? "");
        if (amount <= 0) {
          errors.push(`Строка ${i + 1}: сумма некорректна`);
          continue;
        }
        const catName = ci.category >= 0 ? (r[ci.category] ?? "").toLowerCase() : "";
        const cpName = ci.counterparty >= 0 ? (r[ci.counterparty] ?? "").toLowerCase() : "";
        const prName = ci.project >= 0 ? (r[ci.project] ?? "").toLowerCase() : "";

        inserts.push({
          team_id: teamId,
          type,
          amount,
          currency:
            ci.currency >= 0 && r[ci.currency] ? r[ci.currency].toUpperCase() : account.currency,
          account_id: account.id,
          category_id: catName ? catByKey.get(type + "|" + catName) ?? null : null,
          counterparty_id: cpName ? cpByName.get(cpName) ?? null : null,
          project_id: prName ? prByName.get(prName) ?? null : null,
          occurred_on: date,
          note: ci.note >= 0 ? r[ci.note] || null : null,
          created_by: userId,
        });
      }

      if (inserts.length === 0) {
        throw new Error("Не удалось распознать ни одной строки. " + errors.slice(0, 3).join("; "));
      }

      const supabase = createClient();
      const { error } = await supabase.from("transactions").insert(inserts);
      if (error) throw error;

      setResult(
        `Импортировано операций: ${inserts.length}` +
          (errors.length ? `. Пропущено: ${errors.length}` : "")
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        ⬆ Импорт
      </button>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
          Импорт операций из CSV
        </h3>
        <button onClick={() => setOpen(false)} className="text-sm text-slate-400">
          ✕
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">
        Колонки: Дата · Тип (Доход/Расход) · Категория · Контрагент · Проект ·
        Счёт · Сумма · Валюта · Комментарий. Формат совпадает с экспортом из
        раздела «Отчёты». Счёт должен существовать; категории/контрагенты/проекты
        сопоставляются по названию.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white dark:text-neutral-300"
      />
      {busy && <p className="mt-2 text-sm text-slate-400">Импортируем…</p>}
      {result && (
        <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {result}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </div>
  );
}
