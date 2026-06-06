"use client";

import { useMemo, useState } from "react";
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
  const m2 = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{2})$/);
  if (m2) return `20${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

// Поля, которые мы сопоставляем
type FieldKey =
  | "date" | "amount" | "amountIn" | "amountOut" | "currency"
  | "account" | "category" | "counterparty" | "project" | "note" | "typeCol";

type Mapping = Record<FieldKey, number>; // индекс колонки или -1
type TypeMode = "sign" | "split" | "column";

const NONE = -1;

// Эвристики автоподбора колонок по заголовку
function autoMap(header: string[]): { map: Mapping; mode: TypeMode } {
  const h = header.map((x) => x.toLowerCase());
  const find = (...keys: string[]) =>
    h.findIndex((x) => keys.some((k) => x.includes(k)));
  const map: Mapping = {
    date: find("дата", "date"),
    amount: find("сумма", "amount"),
    amountIn: find("приход", "поступлен", "кредит", "credit", "доход"),
    amountOut: find("расход", "списан", "дебет", "debit", "выплат"),
    currency: find("валюта", "currency"),
    account: find("счёт", "счет", "account", "карт"),
    category: find("категори", "статья", "category"),
    counterparty: find("контрагент", "получател", "плательщик", "назначение"),
    project: find("проект", "project"),
    note: find("коммент", "назначение платеж", "описан", "note", "purpose"),
    typeCol: find("тип", "type", "операци"),
  };
  let mode: TypeMode = "sign";
  if (map.amountIn >= 0 && map.amountOut >= 0) mode = "split";
  else if (map.typeCol >= 0 && map.typeCol !== map.amount) mode = "column";
  return { map, mode };
}

function classifyType(raw: string): "income" | "expense" | null {
  const s = raw.toLowerCase();
  if (/дох|income|credit|кредит|приход|поступл|пополн|\+/.test(s)) return "income";
  if (/рас|expense|debit|дебет|списан|выплат|оплат|-/.test(s)) return "expense";
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
  const [step, setStep] = useState<"pick" | "map">("pick");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({} as Mapping);
  const [typeMode, setTypeMode] = useState<TypeMode>("sign");
  // План создания недостающих счетов: ключ = lower(name)
  const [createPlan, setCreatePlan] = useState<Record<string, { create: boolean; currency: string }>>({});

  const cpByName = new Map(counterparties.map((c) => [c.name.toLowerCase(), c.id]));
  const prByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
  const catByKey = new Map(categories.map((c) => [c.kind + "|" + c.name.toLowerCase(), c.id]));
  const accByName = useMemo(
    () => new Map(accounts.map((a) => [a.name.toLowerCase(), a])),
    [accounts]
  );
  const defaultCurrency = accounts[0]?.currency ?? "RUB";

  function reset() {
    setStep("pick");
    setHeaders([]);
    setRows([]);
    setMapping({} as Mapping);
    setCreatePlan({});
    setError(null);
    setResult(null);
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    try {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("Файл пуст или без данных");
      const delim = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
      const hdr = splitCsvLine(lines[0], delim);
      const dataRows = lines.slice(1).map((l) => splitCsvLine(l, delim));
      const { map, mode } = autoMap(hdr);
      setHeaders(hdr);
      setRows(dataRows);
      setMapping(map);
      setTypeMode(mode);
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка чтения файла");
    }
  }

  // Распознать тип+сумму строки по выбранному режиму
  function rowTypeAmount(r: string[]): { type: "income" | "expense"; amount: number } | null {
    if (typeMode === "split") {
      const inV = mapping.amountIn >= 0 ? parseMoney(r[mapping.amountIn] ?? "") : 0;
      const outV = mapping.amountOut >= 0 ? parseMoney(r[mapping.amountOut] ?? "") : 0;
      if (inV > 0) return { type: "income", amount: inV };
      if (outV !== 0) return { type: "expense", amount: Math.abs(outV) };
      if (inV < 0) return { type: "expense", amount: -inV };
      return null;
    }
    const v = mapping.amount >= 0 ? parseMoney(r[mapping.amount] ?? "") : 0;
    if (typeMode === "column" && mapping.typeCol >= 0) {
      const t = classifyType(r[mapping.typeCol] ?? "");
      if (t) return { type: t, amount: Math.abs(v) || 0 };
    }
    if (v > 0) return { type: "income", amount: v };
    if (v < 0) return { type: "expense", amount: -v };
    return null;
  }

  // Недостающие счета (значения колонки счёта, которых нет среди существующих)
  const missingAccounts = useMemo(() => {
    if (mapping.account === undefined || mapping.account < 0) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    for (const r of rows) {
      const name = (r[mapping.account] ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key) || accByName.has(key)) continue;
      seen.add(key);
      list.push(name);
    }
    return list;
  }, [rows, mapping.account, accByName]);

  function setField(f: FieldKey, idx: number) {
    setMapping((m) => ({ ...m, [f]: idx }));
  }
  function planFor(name: string) {
    return createPlan[name.toLowerCase()] ?? { create: true, currency: defaultCurrency };
  }
  function setPlan(name: string, patch: Partial<{ create: boolean; currency: string }>) {
    const key = name.toLowerCase();
    setCreatePlan((p) => ({ ...p, [key]: { ...planFor(name), ...patch } }));
  }

  async function runImport() {
    setError(null);
    setResult(null);
    if (mapping.date < 0) return setError("Укажите колонку с датой");
    if (mapping.account < 0) return setError("Укажите колонку со счётом");
    if (typeMode === "split" && mapping.amountIn < 0 && mapping.amountOut < 0)
      return setError("Для режима «приход/расход» укажите соответствующие колонки");
    if (typeMode !== "split" && mapping.amount < 0)
      return setError("Укажите колонку с суммой");

    setBusy(true);
    try {
      const supabase = createClient();

      // 1. Создать недостающие счета, выбранные пользователем
      const accMap = new Map(accByName); // lower(name) -> Account
      const toCreate = missingAccounts.filter((n) => planFor(n).create);
      if (toCreate.length > 0) {
        const payload = toCreate.map((n) => ({
          team_id: teamId,
          name: n,
          currency: planFor(n).currency,
          kind: "bank",
        }));
        const { data: created, error: accErr } = await supabase
          .from("accounts")
          .insert(payload)
          .select("id, name, currency");
        if (accErr) throw accErr;
        for (const a of created ?? []) accMap.set(a.name.toLowerCase(), a as Account);
      }

      // 2. Собрать операции
      const inserts: Record<string, unknown>[] = [];
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const ln = i + 2;
        const date = parseDate(r[mapping.date] ?? "");
        if (!date) { errors.push(`Строка ${ln}: некорректная дата`); continue; }
        const ta = rowTypeAmount(r);
        if (!ta || ta.amount <= 0) { errors.push(`Строка ${ln}: сумма/тип не распознаны`); continue; }
        const accName = (r[mapping.account] ?? "").toLowerCase();
        const account = accMap.get(accName);
        if (!account) { errors.push(`Строка ${ln}: счёт «${r[mapping.account]}» пропущен`); continue; }

        const catName = mapping.category >= 0 ? (r[mapping.category] ?? "").toLowerCase() : "";
        const cpName = mapping.counterparty >= 0 ? (r[mapping.counterparty] ?? "").toLowerCase() : "";
        const prName = mapping.project >= 0 ? (r[mapping.project] ?? "").toLowerCase() : "";
        const cur = mapping.currency >= 0 && r[mapping.currency]
          ? r[mapping.currency].toUpperCase()
          : account.currency;

        inserts.push({
          team_id: teamId,
          type: ta.type,
          amount: ta.amount,
          currency: cur,
          account_id: account.id,
          category_id: catName ? catByKey.get(ta.type + "|" + catName) ?? null : null,
          counterparty_id: cpName ? cpByName.get(cpName) ?? null : null,
          project_id: prName ? prByName.get(prName) ?? null : null,
          occurred_on: date,
          note: mapping.note >= 0 ? r[mapping.note] || null : null,
          created_by: userId,
        });
      }

      if (inserts.length === 0)
        throw new Error("Не распознано ни одной строки. " + errors.slice(0, 3).join("; "));

      const { error: insErr } = await supabase.from("transactions").insert(inserts);
      if (insErr) throw insErr;

      setResult(
        `Импортировано: ${inserts.length}` +
          (toCreate.length ? `, создано счетов: ${toCreate.length}` : "") +
          (errors.length ? `, пропущено: ${errors.length}` : "")
      );
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  }

  // Предпросмотр: сколько строк распознается
  const preview = useMemo(() => {
    if (step !== "map") return { ok: 0, bad: 0 };
    let ok = 0, bad = 0;
    for (const r of rows) {
      const date = parseDate(r[mapping.date] ?? "");
      const ta = rowTypeAmount(r);
      if (date && ta && ta.amount > 0) ok++;
      else bad++;
    }
    return { ok, bad };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rows, mapping, typeMode]);

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
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
          Импорт операций из CSV
        </h3>
        <button
          onClick={() => { setOpen(false); reset(); }}
          className="text-sm text-slate-400"
        >
          ✕
        </button>
      </div>

      {step === "pick" && (
        <>
          <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">
            Загрузите CSV (разделитель «,», «;» или табуляция). На следующем шаге
            можно сопоставить колонки вашей выписки с полями и создать недостающие счета.
          </p>
          <input
            type="file"
            accept=".csv,text/csv,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white dark:text-neutral-300"
          />
        </>
      )}

      {step === "map" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            Найдено строк: {rows.length}. Сопоставьте колонки файла с полями.
          </p>

          {/* Режим определения типа операции */}
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-neutral-300">
              Как определять доход/расход?
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {([
                ["sign", "По знаку суммы"],
                ["split", "Отдельные колонки приход/расход"],
                ["column", "По колонке типа"],
              ] as [TypeMode, string][]).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setTypeMode(v)}
                  className={`rounded-full px-3 py-1.5 ${
                    typeMode === v
                      ? "bg-brand text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldSelect label="Дата *" value={mapping.date} headers={headers} onChange={(i) => setField("date", i)} />
            {typeMode === "split" ? (
              <>
                <FieldSelect label="Приход (сумма)" value={mapping.amountIn} headers={headers} onChange={(i) => setField("amountIn", i)} />
                <FieldSelect label="Расход (сумма)" value={mapping.amountOut} headers={headers} onChange={(i) => setField("amountOut", i)} />
              </>
            ) : (
              <FieldSelect label="Сумма *" value={mapping.amount} headers={headers} onChange={(i) => setField("amount", i)} />
            )}
            {typeMode === "column" && (
              <FieldSelect label="Колонка типа" value={mapping.typeCol} headers={headers} onChange={(i) => setField("typeCol", i)} />
            )}
            <FieldSelect label="Валюта" value={mapping.currency} headers={headers} onChange={(i) => setField("currency", i)} />
            <FieldSelect label="Счёт *" value={mapping.account} headers={headers} onChange={(i) => setField("account", i)} />
            <FieldSelect label="Статья" value={mapping.category} headers={headers} onChange={(i) => setField("category", i)} />
            <FieldSelect label="Контрагент" value={mapping.counterparty} headers={headers} onChange={(i) => setField("counterparty", i)} />
            <FieldSelect label="Проект" value={mapping.project} headers={headers} onChange={(i) => setField("project", i)} />
            <FieldSelect label="Комментарий" value={mapping.note} headers={headers} onChange={(i) => setField("note", i)} />
          </div>

          {/* Недостающие счета */}
          {missingAccounts.length > 0 && (
            <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900/40">
              <div className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                Счета не найдены — создать их при импорте?
              </div>
              <div className="space-y-2">
                {missingAccounts.map((n) => {
                  const p = planFor(n);
                  return (
                    <div key={n} className="flex flex-wrap items-center gap-2 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={p.create}
                          onChange={(e) => setPlan(n, { create: e.target.checked })}
                        />
                        <span className="text-slate-700 dark:text-neutral-200">{n}</span>
                      </label>
                      {p.create && (
                        <input
                          value={p.currency}
                          onChange={(e) => setPlan(n, { currency: e.target.value.toUpperCase() })}
                          className="input w-24 py-1 text-sm"
                          placeholder="Валюта"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300/80">
                Снимите галочку, чтобы пропустить строки этого счёта.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Распознается строк: <b className="text-emerald-600 dark:text-emerald-400">{preview.ok}</b>
              {preview.bad > 0 && (
                <> · пропуск: <b className="text-amber-600 dark:text-amber-400">{preview.bad}</b></>
              )}
            </p>
            <div className="flex gap-2">
              <button onClick={reset} className="rounded-full px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-neutral-400">
                Назад
              </button>
              <button
                onClick={runImport}
                disabled={busy || preview.ok === 0}
                className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Импортируем…" : `Импортировать ${preview.ok}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {result}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldSelect({
  label, value, headers, onChange,
}: {
  label: string;
  value: number | undefined;
  headers: string[];
  onChange: (i: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{label}</span>
      <select
        value={value ?? NONE}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input w-full py-2 text-sm"
      >
        <option value={NONE}>— не импортировать —</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>{h || `Колонка ${i + 1}`}</option>
        ))}
      </select>
    </label>
  );
}
