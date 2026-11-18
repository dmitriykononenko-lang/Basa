"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";

type Account = { id: string; name: string; currency: string; number?: string | null };
type Counterparty = { id: string; name: string; inn: string | null };

type Rec = {
  accountNum: string;
  iso: string;
  type: "income" | "expense";
  amount: number; // минорные единицы
  note: string; // назначение платежа
  cpName: string; // контрагент (для внешних операций)
  cpInn: string; // ИНН контрагента
  internal: boolean; // внутренний перевод между своими счетами
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
  const clean = (s || "").replace(/\s| /g, "").replace(",", ".");
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
  counterparties,
}: {
  teamId: string;
  userId: string;
  accounts: Account[];
  counterparties: Counterparty[];
}) {
  const [fileName, setFileName] = useState("");
  const [recs, setRecs] = useState<Rec[]>([]);
  const [missingAccts, setMissingAccts] = useState<string[]>([]);
  const [badRows, setBadRows] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // сопоставление по номеру счёта (приоритет), с откатом на имя
  const acctIndex = new Map<string, Account>();
  for (const a of accounts) {
    acctIndex.set(a.name.trim(), a);
    if (a.number) acctIndex.set(a.number.trim(), a);
  }

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
        acct: col(["счет"]), // «Счет» идёт раньше «Контрагент / счет» — берётся первый
        dir: col(["направление"]),
        amount: col(["сумма"]),
        optype: col(["тип"]),
        cp: col(["контрагент"]),
        inn: col(["инн"]),
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
        if (!acctIndex.has(accountNum)) missing.add(accountNum);
        const optype = norm(ci.optype >= 0 ? c[ci.optype] ?? "" : "");
        const internal = optype.includes("перевод");
        const cpName = (ci.cp >= 0 ? c[ci.cp] ?? "" : "").trim();
        const cpInn = (ci.inn >= 0 ? c[ci.inn] ?? "" : "").trim();
        let note = (ci.purpose >= 0 ? c[ci.purpose] ?? "" : "").trim();
        if (note.length > 300) note = note.slice(0, 299) + "…";
        out.push({ accountNum, iso, type, amount, note, cpName, cpInn, internal });
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

  // Сколько уникальных внешних контрагентов в файле (для превью)
  const extCpCount = useMemo(() => {
    const s = new Set<string>();
    for (const r of recs) if (!r.internal && r.cpName) s.add(r.cpInn || r.cpName.toLowerCase());
    return s.size;
  }, [recs]);

  async function doImport() {
    setBusy(true);
    setError(null);
    setResult(null);
    const supabase = createClient();
    try {
      // 1) Создаём недостающие счета (имя = номер = номер счёта), RUB
      const nameToId = new Map(acctIndex);
      if (missingAccts.length > 0) {
        const { data: created, error: e1 } = await supabase
          .from("accounts")
          .insert(missingAccts.map((n) => ({ team_id: teamId, name: n, number: n, currency: "RUB", kind: "bank" })))
          .select("id, name, currency, number");
        if (e1) throw e1;
        for (const a of created ?? []) {
          nameToId.set(a.name.trim(), a as Account);
          if (a.number) nameToId.set(String(a.number).trim(), a as Account);
        }
      }

      // ───────────────────────────────────────────────────────────────────
      // 2) Канонизация внутренних переводов.
      // Сводная выписка отдаёт перевод между своими счетами ДВУМЯ строками
      // (списание + зачисление). Импорт Точки отдаёт то же событие ОДНОЙ
      // строкой type='transfer'. Из-за этого расхождения одно и то же событие
      // попадало в систему дважды — первопричина FIN-03 (126 задвоенных
      // переводов). Здесь пара сводится к одной канонической строке.
      type Row = {
        type: "income" | "expense" | "transfer";
        amount: number;
        currency: string;
        account_id: string;
        transfer_account_id: string | null;
        occurred_on: string;
        note: string | null;
        counterparty_key: string | null;
        origin: "bank_csv";
      };
      const cpKeyOf = (r: Rec): string | null => {
        if (r.internal || !r.cpName) return null;
        return r.cpInn ? `inn:${r.cpInn}` : `name:${r.cpName.toLowerCase()}`;
      };

      const internals = recs.filter((r) => r.internal);
      const externals = recs.filter((r) => !r.internal);
      const usedIncome = new Set<number>();
      const rows: Row[] = [];
      let merged = 0;

      for (const r of internals) {
        if (r.type !== "expense") continue;
        const accFrom = nameToId.get(r.accountNum)!;
        const idx = internals.findIndex((c, i) =>
          !usedIncome.has(i) && c.type === "income" && c.iso === r.iso &&
          c.amount === r.amount && c.accountNum !== r.accountNum);
        if (idx >= 0) {
          usedIncome.add(idx);
          merged++;
          const accTo = nameToId.get(internals[idx].accountNum)!;
          rows.push({
            type: "transfer", amount: r.amount, currency: accFrom.currency,
            account_id: accFrom.id, transfer_account_id: accTo.id,
            occurred_on: r.iso, note: r.note || null, counterparty_key: null, origin: "bank_csv",
          });
        } else {
          // Встречной ноги в файле нет — оставляем как есть (списание).
          rows.push({
            type: "expense", amount: r.amount, currency: accFrom.currency,
            account_id: accFrom.id, transfer_account_id: null,
            occurred_on: r.iso, note: r.note || null, counterparty_key: null, origin: "bank_csv",
          });
        }
      }
      internals.forEach((r, i) => {
        if (r.type !== "income" || usedIncome.has(i)) return;
        const acc = nameToId.get(r.accountNum)!;
        rows.push({
          type: "income", amount: r.amount, currency: acc.currency,
          account_id: acc.id, transfer_account_id: null,
          occurred_on: r.iso, note: r.note || null, counterparty_key: null, origin: "bank_csv",
        });
      });
      for (const r of externals) {
        const acc = nameToId.get(r.accountNum)!;
        rows.push({
          type: r.type, amount: r.amount, currency: acc.currency,
          account_id: acc.id, transfer_account_id: null,
          occurred_on: r.iso, note: r.note || null, counterparty_key: cpKeyOf(r), origin: "bank_csv",
        });
      }

      const cps = new Map<string, { key: string; name: string; inn: string | null; kind: string }>();
      for (const r of externals) {
        const key = cpKeyOf(r);
        if (!key || cps.has(key)) continue;
        cps.set(key, { key, name: r.cpName, inn: r.cpInn || null, kind: r.type === "income" ? "client" : "supplier" });
      }

      // ───────────────────────────────────────────────────────────────────
      // 3) Одна транзакция БД: батч, контрагенты и операции. Дедуп — по
      // каноническому отпечатку банковского события (bank_event_fp), поэтому
      // событие, уже импортированное из Точки, второй записи не создаёт.
      // Файл отправляется ОДНИМ вызовом: правило кратности отпечатка считает
      // повторы внутри файла относительно уже имеющихся, и дробить его на
      // части нельзя — иначе законные одинаковые операции одного дня потерялись бы.
      const { data: res, error: eImp } = await supabase.rpc("bank_import_commit", {
        p_team: teamId,
        p_batch: {
          file_name: fileName || "Сводная выписка.csv",
          bank: "Сводная выписка",
          status: "imported",
          note: "Импорт сводной выписки (Все операции); внутренние переводы сведены к канонической строке",
        },
        p_rows: rows,
        p_counterparties: [...cps.values()],
        p_request_id: crypto.randomUUID(),
      });
      if (eImp) throw eImp;
      const r = (res ?? {}) as {
        imported?: number; skipped_by_event_id?: number; skipped_by_fingerprint?: number;
        promoted?: number; counterparties?: number;
      };
      const skipped = (r.skipped_by_event_id ?? 0) + (r.skipped_by_fingerprint ?? 0);

      setResult(
        `Загружено операций: ${r.imported ?? 0}. Пропущено как уже учтённые: ${skipped}. ` +
          (merged ? `Переводов сведено в одну операцию: ${merged}. ` : "") +
          (r.promoted ? `Сопоставлено с банковскими событиями: ${r.promoted}. ` : "") +
          (missingAccts.length ? `Создано счетов: ${missingAccts.length}. ` : "") +
          (r.counterparties ? `Создано контрагентов: ${r.counterparties}. ` : "") +
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
        раз, внутренние переводы <b>сводятся к одной операции</b> (как в выписке из банка). Для внешних операций создаются
        карточки контрагентов (по ИНН); категории не проставляются.
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
            <Mini title="Контрагентов в файле" value={String(extCpCount)} />
          </div>

          {(missingAccts.length > 0 || badRows > 0) && (
            <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              {missingAccts.length > 0 && <div>Будут созданы новые счета ({missingAccts.length}): {missingAccts.join(", ")}</div>}
              {badRows > 0 && <div>Пропущено нечитаемых строк: {badRows}</div>}
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
