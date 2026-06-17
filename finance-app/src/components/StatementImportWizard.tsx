"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";

type Account = { id: string; name: string; currency: string };

type Rec = {
  accountNum: string;
  iso: string;
  type: "income" | "expense";
  amount: number; // минорные единицы
  note: string;
};

// Разбор одной CSV-строки с учётом кавычек
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function norm(s: string): string {
  return (s || "").trim().toLowerCase().replace(/ё/g, "е");
}

function parseAmount(s: string): number {
  const clean = (s || "").replace(/\s| /g, "").replace(",", ".");
  const v = parseFloat(clean);
  if (isNaN(v)) return NaN;
  return Math.round(v * 100);
}

function parseDate(s: string): string | null {
  const m = (s || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = (s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export default function StatementImportWizard({
  teamId,
  userId,
  accounts,
}: {
  teamId: string;
  userId: string;
  accounts: Account[];
}) {
  const [fileName, setFileName] = useState("");
  const [recs, setRecs] = useState<Rec[]>([]);
  const [missingAccts, setMissingAccts] = useState<string[]>([]);
  const [badRows, setBadRows] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const acctByName = new Map(accounts.map((a) => [a.name.trim(), a]));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    setRecs([]);
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    try {
      let text = await f.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length < 2) throw new Error("Файл пуст или нет данных");
      const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
      const header = splitCsvLine(lines[0], delim).map(norm);
      const col = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
      const ci = {
        date: col(["дата"]),
        acct: col(["счет"]),
        dir: col(["направление"]),
        amount: col(["сумма"]),
        cp: col(["контрагент"]),
        purpose: col(["назначение"]),
      };
      if (ci.date < 0 || ci.acct < 0 || ci.dir < 0 || ci.amount < 0) {
        throw new Error("Не найдены колонки Дата/Счет/Направление/Сумма. Нужен лист «Все операции».");
      }
      const out: Rec[] = [];
      const missing = new Set<string>();
      let bad = 0;
      for (let i = 1; i < lines.length; i++) {
        const c = splitCsvLine(lines[i], delim);
        const iso = parseDate(c[ci.date] ?? "");
        const accountNum = (c[ci.acct] ?? "").trim();
        const dir = norm(c[ci.dir] ?? "");
        const amount = parseAmount(c[ci.amount] ?? "");
        if (!iso || !accountNum || isNaN(amount) || amount <= 0) { bad++; continue; }
        const type: "income" | "expense" | null =
          dir.startsWith("списан") ? "expense" : dir.startsWith("поступ") ? "income" : null;
        if (!type) { bad++; continue; }
        if (!acctByName.has(accountNum)) missing.add(accountNum);
        const cp = (ci.cp >= 0 ? c[ci.cp] : "") ?? "";
        const purpose = (ci.purpose >= 0 ? c[ci.purpose] : "") ?? "";
        let note = [cp.trim(), purpose.trim()].filter(Boolean).join(" · ");
        if (note.length > 200) note = note.slice(0, 199) + "…";
        out.push({ accountNum, iso, type, amount, note });
      }
      setRecs(out);
      setMissingAccts([...missing]);
      setBadRows(bad);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка чтения файла");
    }
  }

  const incomeCount = recs.filter((r) => r.type === "income").length;
  const expenseCount = recs.filter((r) => r.type === "expense").length;
  const incomeSum = recs.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  const expenseSum = recs.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);

  async function doImport() {
    setBusy(true);
    setError(null);
    setResult(null);
    const supabase = createClient();
    try {
      // 1) Создаём недостающие счета (номер = имя), RUB
      const nameToId = new Map(acctByName);
      if (missingAccts.length > 0) {
        const { data: created, error: e1 } = await supabase
          .from("accounts")
          .insert(missingAccts.map((n) => ({ team_id: teamId, name: n, currency: "RUB", kind: "bank" })))
          .select("id, name, currency");
        if (e1) throw e1;
        for (const a of created ?? []) nameToId.set(a.name.trim(), a as Account);
      }

      // 2) Дедуп против уже существующих операций (по счёту/дате/сумме/типу)
      const ids = [...new Set(recs.map((r) => nameToId.get(r.accountNum)!.id))];
      const isos = recs.map((r) => r.iso).sort();
      const minD = isos[0];
      const maxD = isos[isos.length - 1];
      const { data: existing, error: e2 } = await supabase
        .from("transactions")
        .select("account_id, occurred_on, amount, type")
        .eq("team_id", teamId)
        .in("account_id", ids)
        .gte("occurred_on", minD)
        .lte("occurred_on", maxD);
      if (e2) throw e2;
      const seen = new Set(
        (existing ?? []).map((t) => `${t.account_id}|${t.occurred_on}|${t.amount}|${t.type}`)
      );

      const rows = recs
        .map((r) => {
          const acc = nameToId.get(r.accountNum)!;
          return {
            team_id: teamId,
            account_id: acc.id,
            type: r.type,
            amount: r.amount,
            currency: acc.currency,
            occurred_on: r.iso,
            note: r.note || null,
            status: "actual" as const,
            created_by: userId,
          };
        })
        .filter((row) => {
          const k = `${row.account_id}|${row.occurred_on}|${row.amount}|${row.type}`;
          if (seen.has(k)) return false;
          seen.add(k); // не плодим точные дубли и внутри файла
          return true;
        });

      const skipped = recs.length - rows.length;

      // 3) Батч импорта
      const { data: batch, error: e3 } = await supabase
        .from("import_batches")
        .insert({
          team_id: teamId,
          created_by: userId,
          file_name: fileName || "Сводная выписка.csv",
          row_count: rows.length,
          status: "imported",
          bank: "Сводная выписка",
          note: "Импорт сводной выписки (Все операции), переводы не склеиваются",
        })
        .select("id")
        .single();
      if (e3) throw e3;

      // 4) Вставка пачками
      let inserted = 0;
      const CH = 500;
      for (let i = 0; i < rows.length; i += CH) {
        const part = rows.slice(i, i + CH).map((r) => ({ ...r, import_batch_id: batch.id }));
        const { error: e4 } = await supabase.from("transactions").insert(part);
        if (e4) throw e4;
        inserted += part.length;
      }

      setResult(
        `Загружено операций: ${inserted}. Пропущено дублей: ${skipped}. ` +
          (missingAccts.length ? `Создано счетов: ${missingAccts.length}. ` : "") +
          "Категории не проставлены — разнесите их на странице «Разнести»."
      );
      setRecs([]);
      setMissingAccts([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setError(msg || "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
        Импорт сводной выписки
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
        Загрузите лист «Все операции» в формате CSV (Файл → Сохранить как → CSV). Все счета — за один
        раз, переводы между своими счетами <b>не склеиваются</b>, категории не проставляются.
      </p>

      <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">
        Выбрать CSV
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </label>
      {fileName && <span className="ml-3 text-xs text-slate-400">{fileName}</span>}

      {error && (
        <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {result}
        </div>
      )}

      {recs.length > 0 && (
        <div className="mt-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini title="Всего строк" value={String(recs.length)} />
            <Mini title="Поступления" value={`${incomeCount} · ${formatMoney(incomeSum, "RUB")}`} accent="emerald" />
            <Mini title="Списания" value={`${expenseCount} · ${formatMoney(expenseSum, "RUB")}`} accent="red" />
            <Mini title="Пропущено строк" value={String(badRows)} />
          </div>

          {missingAccts.length > 0 && (
            <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              Будут созданы новые счета ({missingAccts.length}): {missingAccts.join(", ")}
            </div>
          )}

          <button
            type="button"
            onClick={doImport}
            disabled={busy}
            className="mt-4 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Импорт…" : `Импортировать ${recs.length} операций`}
          </button>
        </div>
      )}
    </div>
  );
}

function Mini({ title, value, accent }: { title: string; value: string; accent?: "emerald" | "red" }) {
  const c = accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : accent === "red" ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-neutral-200";
  return (
    <div className="rounded-2xl bg-slate-50 p-3 dark:bg-neutral-900/50">
      <div className="text-[11px] text-slate-400 dark:text-neutral-500">{title}</div>
      <div className={`mt-0.5 text-sm font-semibold ${c}`}>{value}</div>
    </div>
  );
}
