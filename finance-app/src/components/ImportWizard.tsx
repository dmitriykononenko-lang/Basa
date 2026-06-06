"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";
import { ACCOUNT_KINDS, CURRENCIES } from "@/lib/constants";
import Combobox from "@/components/Combobox";
import {
  decodeBuffer, detectDelimiter, splitCsvLine, parseDate, classifyType,
  autoMap, detectBank, NONE,
  type Mapping, type TypeMode, type FieldKey,
} from "@/lib/importParse";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };
export type CategoryRule = { id: string; match_field: string; pattern: string; category_id: string | null; project_id: string | null };

type Resolved = {
  line: number;
  status: "ok" | "transfer" | "dup" | "error";
  reason?: string;
  insert?: Record<string, unknown>;
  reconcileId?: string; // существующая операция → превратить в перевод, строку не вставлять
  cpCreate?: { name: string; inn: string; kind: string }; // контрагента нет в базе — создать при коммите
  cpDisplay?: string; // распознанный контрагент (для превью)
  cpMatched?: boolean; // найден в базе
  date: string;
  typeLabel: string;
  amount: number;
  currency: string;
  accountName: string;
  categoryName: string;
};

type ExistingTx = { id: string; account_id: string | null; occurred_on: string; amount: number; type: string };

const FIELD_LABELS: Record<FieldKey, string> = {
  date: "Дата *", amount: "Сумма *", amountIn: "Приход (сумма)", amountOut: "Расход (сумма)",
  currency: "Валюта", account: "Счёт (в файле)", category: "Статья", counterparty: "Контрагент",
  project: "Проект", note: "Комментарий", typeCol: "Колонка типа",
  payer: "Плательщик", receiver: "Получатель", payerInn: "ИНН плательщика", receiverInn: "ИНН получателя",
};

function daysBetween(a: string, b: string) {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

export default function ImportWizard({
  teamId, userId, accounts: initialAccounts, categories, counterparties, projects, rules = [],
}: {
  teamId: string;
  userId: string;
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  rules?: CategoryRule[];
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [step, setStep] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [bank, setBank] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({} as Mapping);
  const [typeMode, setTypeMode] = useState<TypeMode>("sign");
  const [accountId, setAccountId] = useState("");
  const [skipDup, setSkipDup] = useState(true);
  const [mergeTransfers, setMergeTransfers] = useState(true);
  const [createCps, setCreateCps] = useState(false);
  const [existing, setExisting] = useState<ExistingTx[]>([]);

  // создание счёта
  const [newAccName, setNewAccName] = useState("");
  const [newAccCur, setNewAccCur] = useState("RUB");
  const [newAccKind, setNewAccKind] = useState("bank");
  const [creatingAcc, setCreatingAcc] = useState(false);

  const cpByName = useMemo(() => new Map(counterparties.map((c) => [c.name.toLowerCase(), c.id])), [counterparties]);
  const cpByInn = useMemo(() => new Map(counterparties.filter((c) => c.inn).map((c) => [String(c.inn), c.id])), [counterparties]);
  const prByName = useMemo(() => new Map(projects.map((p) => [p.name.toLowerCase(), p.id])), [projects]);
  const catByKey = useMemo(() => new Map(categories.map((c) => [c.kind + "|" + c.name.toLowerCase(), c.id])), [categories]);
  const catKindById = useMemo(() => new Map(categories.map((c) => [c.id, c.kind])), [categories]);
  const accByLowerName = useMemo(() => new Map(accounts.map((a) => [a.name.toLowerCase(), a])), [accounts]);

  function reset() {
    setStep("upload"); setFileName(""); setBank(null); setHeaders([]); setRows([]);
    setMapping({} as Mapping); setAccountId(""); setExisting([]); setError(null);
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const text = decodeBuffer(buf);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("Файл пуст или без данных");
      const delim = detectDelimiter(lines[0]);
      const hdr = splitCsvLine(lines[0], delim);
      const data = lines.slice(1).map((l) => splitCsvLine(l, delim));
      const preset = detectBank(hdr);
      const { map, mode } = autoMap(hdr);
      setFileName(file.name);
      setHeaders(hdr);
      setRows(data);
      setMapping(map);
      setTypeMode(preset?.typeMode ?? mode);
      setBank(preset?.label ?? null);
      setAccountId(accounts[0]?.id ?? "");
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка чтения файла");
    }
  }

  function setField(f: FieldKey, idx: number) {
    setMapping((m) => ({ ...m, [f]: idx }));
  }

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
      if (t) return { type: t, amount: Math.abs(v) };
    }
    if (v > 0) return { type: "income", amount: v };
    if (v < 0) return { type: "expense", amount: -v };
    return null;
  }

  // Поиск другого своего счёта по тексту строки (внутренний перевод по описанию)
  function matchOtherAccount(r: string[], selfId: string): Account | null {
    const text = [
      mapping.counterparty >= 0 ? r[mapping.counterparty] : "",
      mapping.note >= 0 ? r[mapping.note] : "",
    ].join(" ").toLowerCase();
    if (!text.trim()) return null;
    for (const a of accounts) {
      if (a.id === selfId) continue;
      const n = a.name.toLowerCase();
      if (n.length >= 3 && text.includes(n)) return a;
    }
    return null;
  }

  async function goPreview() {
    setError(null);
    if (!accountId) return setError("Выберите счёт выписки");
    if (mapping.date < 0) return setError("Укажите колонку с датой");
    if (typeMode === "split" && mapping.amountIn < 0 && mapping.amountOut < 0)
      return setError("Укажите колонки прихода/расхода");
    if (typeMode !== "split" && mapping.amount < 0) return setError("Укажите колонку с суммой");

    setBusy(true);
    try {
      // Диапазон дат файла
      let minDate = "9999-12-31", maxDate = "0000-01-01";
      for (const r of rows) {
        const d = parseDate(r[mapping.date] ?? "");
        if (!d) continue;
        if (d < minDate) minDate = d;
        if (d > maxDate) maxDate = d;
      }
      // Существующие операции по всем своим счетам в окне ±3 дня (для дублей и встречных переводов)
      const supabase = createClient();
      let ex: ExistingTx[] = [];
      if (maxDate >= minDate) {
        const lo = new Date(new Date(minDate).getTime() - 3 * 86400000).toISOString().slice(0, 10);
        const hi = new Date(new Date(maxDate).getTime() + 3 * 86400000).toISOString().slice(0, 10);
        const { data } = await supabase
          .from("transactions")
          .select("id, account_id, occurred_on, amount, type")
          .eq("team_id", teamId)
          .gte("occurred_on", lo).lte("occurred_on", hi);
        ex = (data ?? []) as ExistingTx[];
      }
      setExisting(ex);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка подготовки");
    } finally {
      setBusy(false);
    }
  }

  const account = accounts.find((a) => a.id === accountId);

  // Полный разбор строк (для превью и коммита)
  const resolved = useMemo<Resolved[]>(() => {
    if (step !== "preview" || !account) return [];
    const out: Resolved[] = [];
    const fileKeys = new Set<string>();           // дубли внутри файла
    const usedReconcile = new Set<string>();      // чтобы не реконсилить одну операцию дважды
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      const date = parseDate(r[mapping.date] ?? "");
      const ta = rowTypeAmount(r);
      const cur = mapping.currency >= 0 && r[mapping.currency] ? r[mapping.currency].toUpperCase() : account.currency;
      if (!date) { out.push({ line, status: "error", reason: "нет даты", date: "—", typeLabel: "—", amount: 0, currency: cur, accountName: account.name, categoryName: "" }); continue; }
      if (!ta || ta.amount <= 0) { out.push({ line, status: "error", reason: "нет суммы/типа", date, typeLabel: "—", amount: 0, currency: cur, accountName: account.name, categoryName: "" }); continue; }

      const catName = mapping.category >= 0 ? (r[mapping.category] ?? "").toLowerCase() : "";
      const prName = mapping.project >= 0 ? (r[mapping.project] ?? "").toLowerCase() : "";
      const note = mapping.note >= 0 ? r[mapping.note] || null : null;

      // 1) Внутренний перевод по описанию
      const other = mergeTransfers ? matchOtherAccount(r, account.id) : null;
      if (other) {
        const from = ta.type === "expense" ? account.id : other.id;
        const to = ta.type === "expense" ? other.id : account.id;
        out.push({
          line, status: "transfer", reason: `перевод ${ta.type === "expense" ? "→" : "←"} ${other.name}`,
          date, typeLabel: "Перевод", amount: ta.amount, currency: cur, accountName: account.name, categoryName: other.name,
          insert: {
            team_id: teamId, type: "transfer", amount: ta.amount, currency: cur,
            account_id: from, transfer_account_id: to, occurred_on: date, note, status: "actual", created_by: userId,
          },
        });
        continue;
      }

      // 2) Встречная операция на другом счёте (реконсиляция)
      if (mergeTransfers) {
        const match = existing.find((e) =>
          !usedReconcile.has(e.id) && e.account_id && e.account_id !== account.id &&
          e.amount === ta.amount && daysBetween(e.occurred_on, date) <= 3 &&
          ((ta.type === "expense" && e.type === "income") || (ta.type === "income" && e.type === "expense"))
        );
        if (match) {
          usedReconcile.add(match.id);
          const from = ta.type === "expense" ? account.id : match.account_id!;
          const to = ta.type === "expense" ? match.account_id! : account.id;
          out.push({
            line, status: "transfer", reason: "встречная операция → перевод",
            date, typeLabel: "Перевод", amount: ta.amount, currency: cur, accountName: account.name, categoryName: "",
            reconcileId: match.id,
            insert: { type: "transfer", account_id: from, transfer_account_id: to, category_id: null, counterparty_id: null },
          });
          continue;
        }
      }

      // 3) Дубликаты
      const key = `${account.id}|${date}|${ta.amount}|${ta.type}`;
      const inFile = fileKeys.has(key);
      fileKeys.add(key);
      const inDb = existing.some((e) => e.account_id === account.id && e.occurred_on === date && e.amount === ta.amount && e.type === ta.type);
      const catLabel = mapping.category >= 0 ? (r[mapping.category] ?? "") : "";
      if (inFile || inDb) {
        out.push({ line, status: "dup", reason: inFile ? "дубль в файле" : "уже есть в базе", date,
          typeLabel: ta.type === "income" ? "Приход" : "Расход", amount: ta.amount, currency: cur, accountName: account.name, categoryName: catLabel });
        continue;
      }

      // Контрагент: из колонки «Контрагент», иначе по направлению
      // (приход → плательщик, расход → получатель — в обоих случаях это «не мы»). Матч по названию и ИНН.
      let cpName2 = "";
      let cpInn2 = "";
      if (mapping.counterparty >= 0) {
        cpName2 = (r[mapping.counterparty] ?? "").trim();
      } else {
        const nameCol = ta.type === "income" ? mapping.payer : mapping.receiver;
        const innCol = ta.type === "income" ? mapping.payerInn : mapping.receiverInn;
        cpName2 = nameCol >= 0 ? (r[nameCol] ?? "").trim() : "";
        cpInn2 = innCol >= 0 ? (r[innCol] ?? "").trim() : "";
      }
      let cpId: string | null = cpName2 ? cpByName.get(cpName2.toLowerCase()) ?? null : null;
      if (!cpId && cpInn2) cpId = cpByInn.get(cpInn2) ?? null;
      const cpCreate = !cpId && cpName2 && createCps
        ? { name: cpName2, inn: cpInn2, kind: ta.type === "income" ? "client" : "supplier" }
        : undefined;

      // Категория/проект: сначала по имени, затем по правилам авто-категоризации
      let categoryId = catName ? catByKey.get(ta.type + "|" + catName) ?? null : null;
      let projectId = prName ? prByName.get(prName) ?? null : null;
      if (!categoryId && rules.length) {
        const rawCp = mapping.counterparty >= 0 ? (r[mapping.counterparty] ?? "") : "";
        const rawNote = note ?? "";
        for (const rule of rules) {
          if (!rule.category_id) continue;
          const kind = catKindById.get(rule.category_id);
          if (kind && kind !== ta.type) continue;
          const hay = (rule.match_field === "counterparty" ? rawCp : rule.match_field === "note" ? rawNote : rawCp + " " + rawNote).toLowerCase();
          if (rule.pattern && hay.includes(rule.pattern.toLowerCase())) {
            categoryId = rule.category_id;
            if (!projectId) projectId = rule.project_id;
            break;
          }
        }
      }

      out.push({
        line, status: "ok", date, typeLabel: ta.type === "income" ? "Приход" : "Расход",
        amount: ta.amount, currency: cur, accountName: account.name,
        categoryName: catLabel,
        cpCreate, cpDisplay: cpName2 || undefined, cpMatched: !!cpId,
        insert: {
          team_id: teamId, type: ta.type, amount: ta.amount, currency: cur, account_id: account.id,
          category_id: categoryId,
          counterparty_id: cpId,
          project_id: projectId,
          occurred_on: date, note, status: "actual", created_by: userId,
        },
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rows, mapping, typeMode, account, existing, mergeTransfers, rules, createCps]);

  const counts = useMemo(() => {
    const c = { ok: 0, transfer: 0, dup: 0, error: 0 };
    for (const r of resolved) c[r.status]++;
    return c;
  }, [resolved]);

  async function createAccount() {
    if (!newAccName.trim()) return;
    setCreatingAcc(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("accounts")
        .insert({ team_id: teamId, name: newAccName.trim(), currency: newAccCur, kind: newAccKind })
        .select("id, name, currency").single();
      if (error) throw error;
      const acc = data as Account;
      setAccounts((prev) => [...prev, acc]);
      setAccountId(acc.id);
      setNewAccName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать счёт");
    } finally {
      setCreatingAcc(false);
    }
  }

  async function runImport() {
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const toInsert = resolved.filter((r) => (r.status === "ok" || r.status === "transfer") && r.insert && !r.reconcileId)
        .concat(skipDup ? [] : resolved.filter((r) => r.status === "dup"));
      const reconciles = resolved.filter((r) => r.reconcileId && r.insert);

      if (toInsert.length === 0 && reconciles.length === 0)
        throw new Error("Нет строк для импорта");

      // 1) батч
      const { data: batch, error: bErr } = await supabase
        .from("import_batches")
        .insert({ team_id: teamId, created_by: userId, file_name: fileName, account_id: accountId, bank, row_count: toInsert.length })
        .select("id").single();
      if (bErr) throw bErr;
      const batchId = (batch as { id: string }).id;

      // 2) реконсиляция встречных (existing → перевод)
      for (const r of reconciles) {
        await supabase.from("transactions").update(r.insert!).eq("id", r.reconcileId!);
      }

      // 2.5) создать недостающих контрагентов (по плательщику/получателю)
      let createdCps = 0;
      if (createCps) {
        const uniq = new Map<string, { name: string; inn: string; kind: string }>();
        for (const r of toInsert) {
          if (r.cpCreate) {
            const k = r.cpCreate.name.toLowerCase();
            if (!uniq.has(k)) uniq.set(k, r.cpCreate);
          }
        }
        if (uniq.size > 0) {
          const payload = [...uniq.values()].map((c) => ({ team_id: teamId, name: c.name, inn: c.inn || null, kind: c.kind, kinds: [c.kind] }));
          const { data: created, error: cErr } = await supabase.from("counterparties").insert(payload).select("id, name");
          if (cErr) { await supabase.from("import_batches").delete().eq("id", batchId); throw cErr; }
          createdCps = created?.length ?? 0;
          const nameToId = new Map((created ?? []).map((c) => [(c.name as string).toLowerCase(), c.id]));
          for (const r of toInsert) {
            if (r.cpCreate && r.insert && !r.insert.counterparty_id) {
              r.insert.counterparty_id = nameToId.get(r.cpCreate.name.toLowerCase()) ?? null;
            }
          }
        }
      }

      // 3) вставка операций батча
      if (toInsert.length > 0) {
        const payload = toInsert.map((r) => ({ ...r.insert, import_batch_id: batchId }));
        const { error: iErr } = await supabase.from("transactions").insert(payload);
        if (iErr) { await supabase.from("import_batches").delete().eq("id", batchId); throw iErr; }
      } else {
        // батч без вставок (только реконсиляция) — удалим пустой батч
        await supabase.from("import_batches").delete().eq("id", batchId);
      }

      setResultMsg(
        `Импортировано: ${toInsert.length}` +
        (createdCps ? `, создано контрагентов: ${createdCps}` : "") +
        (reconciles.length ? `, переводов реконсилировано: ${reconciles.length}` : "") +
        (skipDup && counts.dup ? `, пропущено дублей: ${counts.dup}` : "") +
        (counts.error ? `, ошибок: ${counts.error}` : "")
      );
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  }

  const headerOpts = headers.map((h, i) => ({ value: String(i), label: h || `Колонка ${i + 1}` }));

  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-neutral-200">Импорт банковской выписки</h3>

      {step === "upload" && (
        <>
          <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">
            CSV/TXT (UTF-8 или Windows-1251; разделитель «,», «;» или таб). На следующем
            шаге сопоставите колонки и выберете счёт выписки.
          </p>
          <input
            type="file" accept=".csv,.txt,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white dark:text-neutral-300"
          />
        </>
      )}

      {step === "map" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            Файл: <b>{fileName}</b> · строк: {rows.length}{bank && <> · банк: <b>{bank}</b></>}
          </p>

          {/* Счёт выписки */}
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-neutral-300">Счёт этой выписки</div>
            <Combobox
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, search: a.name }))}
              placeholder="— выберите счёт —"
            />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-brand">Создать новый счёт</summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={newAccName} onChange={(e) => setNewAccName(e.target.value)} placeholder="Название" className="input w-40 py-1.5 text-sm" />
                <select value={newAccCur} onChange={(e) => setNewAccCur(e.target.value)} className="input w-24 py-1.5 text-sm">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={newAccKind} onChange={(e) => setNewAccKind(e.target.value)} className="input w-28 py-1.5 text-sm">
                  {ACCOUNT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <button onClick={createAccount} disabled={creatingAcc || !newAccName.trim()} className="rounded-full bg-slate-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:bg-neutral-700">
                  {creatingAcc ? "…" : "Создать"}
                </button>
              </div>
            </details>
          </div>

          {/* Режим типа */}
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-neutral-300">Как определять доход/расход?</div>
            <div className="flex flex-wrap gap-2 text-sm">
              {([["sign", "По знаку суммы"], ["split", "Колонки приход/расход"], ["column", "По колонке типа"]] as [TypeMode, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setTypeMode(v)}
                  className={`rounded-full px-3 py-1.5 ${typeMode === v ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-white/10"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Сопоставление */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldRow k="date" mapping={mapping} setField={setField} opts={headerOpts} />
            {typeMode === "split" ? (
              <>
                <FieldRow k="amountIn" mapping={mapping} setField={setField} opts={headerOpts} />
                <FieldRow k="amountOut" mapping={mapping} setField={setField} opts={headerOpts} />
              </>
            ) : (
              <FieldRow k="amount" mapping={mapping} setField={setField} opts={headerOpts} />
            )}
            {typeMode === "column" && <FieldRow k="typeCol" mapping={mapping} setField={setField} opts={headerOpts} />}
            <FieldRow k="currency" mapping={mapping} setField={setField} opts={headerOpts} />
            <FieldRow k="category" mapping={mapping} setField={setField} opts={headerOpts} />
            <FieldRow k="project" mapping={mapping} setField={setField} opts={headerOpts} />
            <FieldRow k="note" mapping={mapping} setField={setField} opts={headerOpts} />
          </div>

          {/* Контрагент: одна колонка ИЛИ раздельные плательщик/получатель */}
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
            <div className="mb-1 text-xs font-medium text-slate-600 dark:text-neutral-300">Контрагент</div>
            <p className="mb-2 text-xs text-slate-400 dark:text-neutral-500">
              Если в выписке одна колонка контрагента — укажите её. Если раздельные «плательщик»
              и «получатель» (Точка/1С) — укажите обе: для прихода берётся плательщик, для расхода — получатель.
              Сопоставление по названию и ИНН.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldRow k="counterparty" mapping={mapping} setField={setField} opts={headerOpts} />
              <FieldRow k="payer" mapping={mapping} setField={setField} opts={headerOpts} />
              <FieldRow k="receiver" mapping={mapping} setField={setField} opts={headerOpts} />
              <FieldRow k="payerInn" mapping={mapping} setField={setField} opts={headerOpts} />
              <FieldRow k="receiverInn" mapping={mapping} setField={setField} opts={headerOpts} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
            <input type="checkbox" checked={mergeTransfers} onChange={(e) => setMergeTransfers(e.target.checked)} />
            Объединять встречные операции между своими счетами в переводы
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
            <input type="checkbox" checked={createCps} onChange={(e) => setCreateCps(e.target.checked)} />
            Создавать недостающих контрагентов из выписки (по плательщику/получателю)
          </label>
          {mapping.counterparty < 0 && (mapping.payer >= 0 || mapping.receiver >= 0) && (
            <p className="text-xs text-slate-400 dark:text-neutral-500">
              Контрагент определяется по направлению: для прихода — плательщик, для расхода — получатель.
              Сопоставление по названию и ИНН.
            </p>
          )}

          <div className="flex justify-between">
            <button onClick={reset} className="rounded-full px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-neutral-400">← Другой файл</button>
            <button onClick={goPreview} disabled={busy} className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "…" : "Превью →"}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge color="emerald" label={`К импорту: ${counts.ok}`} />
            {counts.transfer > 0 && <Badge color="brand" label={`Переводы: ${counts.transfer}`} />}
            {counts.dup > 0 && <Badge color="amber" label={`Дубли: ${counts.dup}`} />}
            {counts.error > 0 && <Badge color="red" label={`Ошибки: ${counts.error}`} />}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
            <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} /> Пропускать дубликаты
          </label>

          <div className="max-h-72 overflow-auto rounded-2xl ring-1 ring-slate-200/70 dark:ring-white/[0.07]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-400 dark:bg-[#1b1d22]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Дата</th>
                  <th className="px-3 py-2 text-left font-medium">Тип</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                  <th className="px-3 py-2 text-left font-medium">Контрагент</th>
                  <th className="px-3 py-2 text-left font-medium">Статья</th>
                  <th className="px-3 py-2 text-left font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 60).map((r) => (
                  <tr key={r.line} className="border-t border-slate-100 dark:border-white/[0.05]">
                    <td className="px-3 py-1.5">{r.date}</td>
                    <td className="px-3 py-1.5">{r.typeLabel}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.amount ? formatMoney(r.amount, r.currency) : "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {r.cpDisplay ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="max-w-[180px] truncate" title={r.cpDisplay}>{r.cpDisplay}</span>
                          {r.cpMatched ? (
                            <span className="text-emerald-500" title="Найден в базе">✓</span>
                          ) : r.cpCreate ? (
                            <span className="rounded bg-brand/10 px-1 text-[10px] text-brand">новый</span>
                          ) : (
                            <span className="text-amber-500" title="Не сопоставлен — будет без контрагента (включите создание)">!</span>
                          )}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{r.categoryName || "—"}</td>
                    <td className="px-3 py-1.5">
                      <StatusChip status={r.status} reason={r.reason} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resolved.length > 60 && <p className="text-xs text-slate-400">…и ещё {resolved.length - 60} строк</p>}

          <div className="flex justify-between">
            <button onClick={() => setStep("map")} className="rounded-full px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-neutral-400">← Назад</button>
            <button onClick={runImport} disabled={busy || (counts.ok + counts.transfer === 0 && (skipDup || counts.dup === 0))}
              className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Импортируем…" : `Импортировать ${counts.ok + counts.transfer}`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          {resultMsg && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{resultMsg}</p>}
          <button onClick={() => { reset(); setResultMsg(null); }} className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white">Импортировать ещё</button>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </div>
  );
}

function FieldRow({ k, mapping, setField, opts }: { k: FieldKey; mapping: Mapping; setField: (f: FieldKey, i: number) => void; opts: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{FIELD_LABELS[k]}</span>
      <Combobox
        value={mapping[k] >= 0 ? String(mapping[k]) : ""}
        onChange={(v) => setField(k, v === "" ? NONE : Number(v))}
        options={opts}
        placeholder="— не импортировать —"
        emptyLabel="— не импортировать —"
      />
    </label>
  );
}

function Badge({ color, label }: { color: "emerald" | "brand" | "amber" | "red"; label: string }) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40",
    brand: "bg-brand/10 text-brand ring-brand/30",
    amber: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40",
    red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40",
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${map[color]}`}>{label}</span>;
}

function StatusChip({ status, reason }: { status: Resolved["status"]; reason?: string }) {
  const map = {
    ok: ["✓ ок", "text-emerald-600 dark:text-emerald-400"],
    transfer: [reason ?? "перевод", "text-brand"],
    dup: [reason ?? "дубль", "text-amber-600 dark:text-amber-400"],
    error: [reason ?? "ошибка", "text-red-600 dark:text-red-400"],
  } as const;
  const [label, cls] = map[status];
  return <span className={cls}>{label}</span>;
}
