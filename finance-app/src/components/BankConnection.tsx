"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

type Named = { id: string; name: string };
type TochkaAccount = { accountId: string; accountNumber: string | null; currency: string; name: string | null };

export default function BankConnection({
  connected, apiVersion, lastSyncedAt, defaultAccountId, incomeCategoryId, expenseCategoryId,
  accounts, incomeCategories, expenseCategories,
}: {
  connected: boolean;
  apiVersion: string;
  lastSyncedAt: string | null;
  defaultAccountId: string | null;
  incomeCategoryId: string | null;
  expenseCategoryId: string | null;
  accounts: Named[];
  incomeCategories: Named[];
  expenseCategories: Named[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [token, setToken] = useState("");
  const [ver, setVer] = useState(apiVersion);
  const [accId, setAccId] = useState(defaultAccountId ?? "");
  const [incCat, setIncCat] = useState(incomeCategoryId ?? "");
  const [expCat, setExpCat] = useState(expenseCategoryId ?? "");
  const [savingBusy, setSavingBusy] = useState(false);

  const [tochkaAccounts, setTochkaAccounts] = useState<TochkaAccount[]>([]);
  const [tochkaAccId, setTochkaAccId] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [importBusy, setImportBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; transfers: number; total: number } | null>(null);
  const [rawDebug, setRawDebug] = useState<string | null>(null);

  async function save() {
    setSavingBusy(true);
    const res = await fetch("/api/tochka/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token.trim() || undefined,
        apiVersion: ver.trim(),
        defaultAccountId: accId || null,
        incomeCategoryId: incCat || null,
        expenseCategoryId: expCat || null,
      }),
    });
    setSavingBusy(false);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Не удалось сохранить"); return; }
    setToken("");
    toast.success("Подключение сохранено");
    router.refresh();
  }

  async function test() {
    setTestBusy(true);
    setResult(null);
    const res = await fetch("/api/tochka/test");
    setTestBusy(false);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Ошибка подключения"); return; }
    setTochkaAccounts(json.accounts ?? []);
    setTochkaAccId(json.accounts?.[0]?.accountId ?? "");
    toast.success(`Подключение работает: счетов ${json.accounts?.length ?? 0}`);
  }

  async function runImport() {
    setImportBusy(true);
    setResult(null);
    const res = await fetch("/api/tochka/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tochkaAccountId: tochkaAccId || undefined, from, to }),
    });
    setImportBusy(false);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Ошибка импорта"); return; }
    setResult({ imported: json.imported, skipped: json.skipped, transfers: json.transfers, total: json.total });
    toast.success(`Импортировано: ${json.imported}`);
    router.refresh();
  }

  async function debugRaw() {
    setRawDebug("Загрузка…");
    const res = await fetch("/api/tochka/import?debug=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tochkaAccountId: tochkaAccId || undefined, from, to }),
    });
    const json = await res.json();
    setRawDebug(JSON.stringify(json.raw ?? json, null, 2));
  }

  async function disconnect() {
    if (!confirm("Отключить Точку? Импортированные операции останутся.")) return;
    const res = await fetch("/api/tochka/connect", { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Не удалось отключить"); return; }
    toast.success("Точка отключена");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Статус */}
      <div className="flex items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-300 dark:bg-neutral-600"}`} />
        <div className="text-sm">
          <div className="font-semibold text-slate-800 dark:text-neutral-100">{connected ? "Подключено" : "Не подключено"}</div>
          {connected && lastSyncedAt && (
            <div className="text-xs text-slate-400 dark:text-neutral-500">Последний импорт: {formatDate(lastSyncedAt)}</div>
          )}
        </div>
        {connected && (
          <button onClick={disconnect} className="ml-auto rounded-full px-3 py-1.5 text-sm font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10">Отключить</button>
        )}
      </div>

      {/* Настройки подключения */}
      <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Подключение</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">JWT-токен Точки</label>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connected ? "оставьте пустым, чтобы не менять" : "вставьте токен из интернет-банка (длинная строка ~900 символов)"}
            className="input min-h-[88px] resize-y break-all font-mono text-xs leading-relaxed"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
          />
          <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
            {token.trim()
              ? <>Введено символов: <b className={token.trim().length > 400 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{token.trim().length}</b>{token.trim().length < 400 && " — похоже на обрезанный ключ, вставьте целиком"}</>
              : "Интернет-банк Точки → «Интеграции и API» → выпуск токена с правами на чтение счетов и выписок."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Счёт для импорта</label>
            <Select value={accId} onChange={setAccId} options={[{ value: "", label: "— не выбран —" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статья доходов по умолчанию</label>
            <Select value={incCat} onChange={setIncCat} options={[{ value: "", label: "— не выбрана —" }, ...incomeCategories.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статья расходов по умолчанию</label>
            <Select value={expCat} onChange={setExpCat} options={[{ value: "", label: "— не выбрана —" }, ...expenseCategories.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={savingBusy} className="btn-primary">{savingBusy ? "…" : "Сохранить"}</button>
          {connected && <button onClick={test} disabled={testBusy} className="btn-ghost">{testBusy ? "Проверка…" : "Проверить подключение"}</button>}
        </div>
        {tochkaAccounts.length > 0 && (
          <ul className="space-y-1 rounded-2xl bg-slate-50 p-3 text-sm dark:bg-white/[0.03]">
            {tochkaAccounts.map((a) => (
              <li key={a.accountId} className="flex justify-between text-slate-600 dark:text-neutral-300">
                <span>{a.accountNumber ?? a.accountId}</span>
                <span className="text-slate-400">{a.currency}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Импорт */}
      {connected && (
        <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Импорт операций</h2>
          <div className="flex flex-wrap items-end gap-2">
            {tochkaAccounts.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Счёт в Точке</label>
                <Select value={tochkaAccId} onChange={setTochkaAccId} options={tochkaAccounts.map((a) => ({ value: a.accountId, label: a.accountNumber ?? a.accountId }))} />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">С</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-40" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">По</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input w-40" />
            </div>
            <button onClick={runImport} disabled={importBusy} className="btn-primary">{importBusy ? "Импорт…" : "Импортировать"}</button>
            <button onClick={debugRaw} type="button" className="btn-ghost text-xs">Сырой ответ (debug)</button>
          </div>
          {rawDebug && (
            <pre className="max-h-80 overflow-auto rounded-2xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{rawDebug}</pre>
          )}
          {tochkaAccounts.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-neutral-500">Нажмите «Проверить подключение», чтобы выбрать счёт. Без выбора импортируется первый счёт.</p>
          )}
          {result && (
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              Импортировано: <b>{result.imported}</b> · пропущено (уже были): {result.skipped} · переводов между счетами: {result.transfers} · всего в выписке: {result.total}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
