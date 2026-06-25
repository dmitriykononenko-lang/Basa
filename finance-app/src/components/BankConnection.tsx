"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

type Named = { id: string; name: string };
type TochkaAccount = { accountId: string; accountNumber: string | null; currency: string; name: string | null };

export default function BankConnection({
  connected, apiVersion, lastSyncedAt, defaultAccountId, incomeCategoryId, expenseCategoryId,
  accounts, incomeCategories, expenseCategories, accountLinks,
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
  accountLinks: { external: string; accountId: string | null }[];
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

  // Сопоставление номер счёта Точки → счёт Basa.
  const [mapping, setMapping] = useState<Record<string, string>>(
    () => Object.fromEntries(accountLinks.filter((l) => l.accountId).map((l) => [l.external, l.accountId as string])),
  );
  const [mapBusy, setMapBusy] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [hints, setHints] = useState<Record<string, string>>({});
  const accByName = useMemo(() => new Map(accounts.map((a) => [a.name.trim(), a.id])), [accounts]);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [importBusy, setImportBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; transfers: number; counterparties: number; total: number } | null>(null);
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
    const accs: TochkaAccount[] = json.accounts ?? [];
    setTochkaAccounts(accs);
    setTochkaAccId(accs[0]?.accountId ?? "");
    // Автосопоставление: если в Basa есть счёт с именем = номер счёта Точки.
    setMapping((prev) => {
      const next = { ...prev };
      for (const a of accs) {
        const num = a.accountNumber;
        if (num && !next[num] && accByName.has(num)) next[num] = accByName.get(num)!;
      }
      return next;
    });
    toast.success(`Подключение работает: счетов ${accs.length}`);
  }

  async function saveMapping() {
    setMapBusy(true);
    const links = tochkaAccounts
      .map((a) => ({ external: a.accountNumber ?? "", accountId: mapping[a.accountNumber ?? ""] || null }))
      .filter((l) => l.external);
    const res = await fetch("/api/tochka/mapping", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links }),
    });
    setMapBusy(false);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Не удалось сохранить"); return; }
    toast.success(`Сопоставлено счетов: ${json.saved}`);
    router.refresh();
  }

  async function suggestMapping() {
    if (tochkaAccounts.length === 0) { toast.error("Сначала «Проверить подключение»"); return; }
    setSuggestBusy(true);
    const next: Record<string, string> = { ...mapping };
    const newHints: Record<string, string> = { ...hints };
    let matched = 0;
    for (const a of tochkaAccounts) {
      const num = a.accountNumber ?? a.accountId;
      // 1) Счёт с именем = номер.
      if (accByName.has(num)) { next[num] = accByName.get(num)!; newHints[num] = "счёт по номеру"; matched++; continue; }
      // 2) По преобладающему фонду в назначениях выписки.
      try {
        const res = await fetch("/api/tochka/suggest", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tochkaAccountId: a.accountId, from, to }),
        });
        const j = await res.json();
        if (!res.ok) { newHints[num] = "не удалось прочитать выписку"; continue; }
        if (j.topFund) {
          newHints[num] = `по выпискам: фонд ${j.topFund} · ${j.opsCount} оп.`;
          const want = `фонд ${j.topFund}`.toLowerCase();
          const hit = accounts.find((acc) => acc.name.trim().toLowerCase() === want)
            ?? accounts.find((acc) => acc.name.trim().toLowerCase().includes(want));
          if (hit) { next[num] = hit.id; matched++; }
        } else {
          newHints[num] = j.opsCount ? `разные назначения · ${j.opsCount} оп. (похоже, операционный)` : "нет операций за период";
        }
      } catch { newHints[num] = "ошибка анализа"; }
    }
    setMapping(next);
    setHints(newHints);
    setSuggestBusy(false);
    toast.success(`Подсказано: ${matched} из ${tochkaAccounts.length}. Проверьте и сохраните.`);
  }

  async function importAll() {
    if (tochkaAccounts.length === 0) { toast.error("Сначала «Проверить подключение»"); return; }
    setImportBusy(true);
    setResult(null);
    let imported = 0, skipped = 0, transfers = 0, counterparties = 0, total = 0, failed = 0;
    for (const a of tochkaAccounts) {
      try {
        const res = await fetch("/api/tochka/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tochkaAccountId: a.accountId, from, to }),
        });
        const j = await res.json();
        if (!res.ok) { failed++; continue; }
        imported += j.imported ?? 0; skipped += j.skipped ?? 0; transfers += j.transfers ?? 0;
        counterparties += j.counterparties ?? 0; total += j.total ?? 0;
      } catch { failed++; }
    }
    setImportBusy(false);
    setResult({ imported, skipped, transfers, counterparties, total });
    toast.success(`Импорт по всем счетам: +${imported}${failed ? ` (ошибок счетов: ${failed})` : ""}`);
    router.refresh();
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
    setResult({ imported: json.imported, skipped: json.skipped, transfers: json.transfers, counterparties: json.counterparties ?? 0, total: json.total });
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
        {tochkaAccounts.length > 0 && (() => {
          const mappedCount = tochkaAccounts.filter((a) => mapping[a.accountNumber ?? a.accountId]).length;
          return (
          <div className="space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Какой счёт Точки = какой счёт Basa</div>
                <div className="text-xs text-slate-400 dark:text-neutral-500">Сопоставлено {mappedCount} из {tochkaAccounts.length}. Нужно, чтобы переводы между своими счетами заполняли оба конца.</div>
              </div>
              <div className="flex gap-2">
                <button onClick={suggestMapping} disabled={suggestBusy} className="rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:bg-white/10 dark:text-neutral-200">{suggestBusy ? "Анализирую выписки…" : "✨ Подсказать"}</button>
                <button onClick={saveMapping} disabled={mapBusy} className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{mapBusy ? "…" : "Сохранить"}</button>
              </div>
            </div>
            <div className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
              {tochkaAccounts.map((a) => {
                const num = a.accountNumber ?? a.accountId;
                const mapped = mapping[num];
                const hint = hints[num];
                return (
                  <div key={a.accountId} className="grid grid-cols-[1fr,auto,1.2fr] items-center gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-slate-700 dark:text-neutral-200">{num}</div>
                      <div className="truncate text-[11px] text-slate-400 dark:text-neutral-500">
                        {a.currency}{hint ? ` · ${hint}` : ""}
                      </div>
                    </div>
                    <span className={mapped ? "text-emerald-500" : "text-slate-300 dark:text-neutral-600"}>→</span>
                    <Select
                      className="w-full"
                      value={mapped ?? ""}
                      onChange={(v) => setMapping((p) => ({ ...p, [num]: v }))}
                      options={[{ value: "", label: "— выберите счёт Basa —" }, ...accounts.map((acc) => ({ value: acc.id, label: acc.name }))]}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-neutral-500">
              💡 «Подсказать» читает назначения в выписках и определяет фонды. Операционные счета (разные назначения) сопоставьте вручную — обычно это ваши номерные счета.
            </p>
          </div>
          );
        })()}
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
            <button onClick={runImport} disabled={importBusy} className="btn-primary">{importBusy ? "Импорт…" : "Импортировать счёт"}</button>
            <button onClick={importAll} disabled={importBusy || tochkaAccounts.length === 0} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{importBusy ? "Импорт…" : "Импортировать все счета"}</button>
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
              Импортировано: <b>{result.imported}</b> · новых контрагентов: {result.counterparties} · переводов между счетами: {result.transfers} · пропущено (уже были): {result.skipped} · всего в выписке: {result.total}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
