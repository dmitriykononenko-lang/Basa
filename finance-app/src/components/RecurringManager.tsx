"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";
import { toast } from "@/lib/toast";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string };
type Category = { id: string; name: string; kind: "income" | "expense" };

export type RecurringRule = {
  id: string; type: "income" | "expense" | "transfer"; amount: number; currency: string;
  account_id: string | null; transfer_account_id: string | null; category_id: string | null;
  counterparty_id: string | null; project_id: string | null; note: string | null;
  frequency: string; day_of_month: number | null; weekday: number | null;
  start_date: string; end_date: string | null; active: boolean;
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HORIZON_DAYS = 92;

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoOf(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function occurrences(rule: RecurringRule, fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const from = new Date(Math.max(+new Date(fromISO), +new Date(rule.start_date)));
  const to = rule.end_date ? new Date(Math.min(+new Date(toISO), +new Date(rule.end_date))) : new Date(toISO);
  if (from > to) return out;
  if (rule.frequency === "weekly") {
    const d = new Date(from);
    const target = rule.weekday ?? 0;
    while (((d.getDay() + 6) % 7) !== target) d.setDate(d.getDate() + 1);
    while (d <= to) { if (d >= from) out.push(isoOf(d)); d.setDate(d.getDate() + 7); }
  } else {
    let y = from.getFullYear(), m = from.getMonth();
    for (let i = 0; i < 60; i++) {
      const dim = new Date(y, m + 1, 0).getDate();
      const day = Math.min(rule.day_of_month ?? 1, dim);
      const d = new Date(y, m, day);
      if (d >= from && d <= to) out.push(isoOf(d));
      m++; if (m > 11) { m = 0; y++; }
      if (new Date(y, m, 1) > to) break;
    }
  }
  return out;
}

export default function RecurringManager({
  teamId, userId, rules, accounts, categories, counterparties, projects,
}: {
  teamId: string;
  userId: string;
  rules: RecurringRule[];
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [weekday, setWeekday] = useState(0);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—";
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;
  const filteredCats = categories.filter((c) => c.kind === type);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму больше нуля");
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return setError("Выберите счёт");
    if (type === "transfer" && !transferAccountId) return setError("Выберите счёт назначения");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("recurring_rules").insert({
      team_id: teamId, type, amount: minor, currency: account.currency,
      account_id: accountId, transfer_account_id: type === "transfer" ? transferAccountId : null,
      category_id: type === "transfer" ? null : categoryId || null,
      counterparty_id: type === "transfer" ? null : counterpartyId || null,
      project_id: projectId || null, note: note || null,
      frequency, day_of_month: frequency === "monthly" ? dayOfMonth : null,
      weekday: frequency === "weekly" ? weekday : null,
      start_date: startDate, end_date: endDate || null, created_by: userId,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setAmount(""); setNote(""); setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Удалить шаблон? Уже созданные плановые операции останутся.")) return;
    const supabase = createClient();
    await supabase.from("recurring_rules").delete().eq("id", id);
    router.refresh();
  }

  async function toggleActive(rule: RecurringRule) {
    const supabase = createClient();
    await supabase.from("recurring_rules").update({ active: !rule.active }).eq("id", rule.id);
    router.refresh();
  }

  async function generate() {
    setBusy(true); setError(null); setMsg(null);
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);
    const horizon = isoOf(new Date(Date.now() + HORIZON_DAYS * 86400000));
    const active = rules.filter((r) => r.active);
    if (active.length === 0) { setBusy(false); setMsg("Нет активных шаблонов"); return; }

    const { data: existing } = await supabase
      .from("transactions")
      .select("recurring_rule_id, occurred_on")
      .eq("team_id", teamId)
      .not("recurring_rule_id", "is", null)
      .gte("occurred_on", today);
    const have = new Set((existing ?? []).map((e) => `${e.recurring_rule_id}|${e.occurred_on}`));

    const inserts: Record<string, unknown>[] = [];
    for (const rule of active) {
      for (const d of occurrences(rule, today, horizon)) {
        const key = `${rule.id}|${d}`;
        if (have.has(key)) continue;
        have.add(key);
        inserts.push({
          team_id: teamId, type: rule.type, amount: rule.amount, currency: rule.currency,
          account_id: rule.account_id, transfer_account_id: rule.transfer_account_id,
          category_id: rule.type === "transfer" ? null : rule.category_id,
          counterparty_id: rule.type === "transfer" ? null : rule.counterparty_id,
          project_id: rule.project_id, occurred_on: d, note: rule.note,
          status: "planned", created_by: userId, recurring_rule_id: rule.id,
        });
      }
    }
    if (inserts.length > 0) {
      const { error } = await supabase.from("transactions").insert(inserts);
      if (error) { setBusy(false); setError(error.message); return; }
    }
    setBusy(false);
    setMsg(`Создано плановых операций: ${inserts.length}`);
    toast.success(inserts.length ? `Создано плановых операций: ${inserts.length}` : "Новых операций нет — всё уже создано");
    router.refresh();
  }

  const TYPES: [typeof type, string][] = [["income", "Доход"], ["expense", "Расход"], ["transfer", "Перевод"]];
  const freqLabel = (r: RecurringRule) =>
    r.frequency === "weekly" ? `еженедельно (${WEEKDAYS[r.weekday ?? 0]})` : `ежемесячно (${r.day_of_month}-е число)`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={generate} disabled={busy} className="btn-primary">
          {busy ? "…" : `Сгенерировать плановые (${Math.round(HORIZON_DAYS / 30)} мес)`}
        </button>
        <button onClick={() => setOpen((o) => !o)} className="btn-ghost ring-1 ring-slate-200 dark:ring-white/10">
          {open ? "Отмена" : "+ Шаблон"}
        </button>
        {msg && <span className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</span>}
      </div>

      {open && (
        <form onSubmit={add} className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
            {TYPES.map(([t, l]) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`rounded-full px-2 py-1.5 font-medium transition ${type === t ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <F label="Сумма"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input" /></F>
            <F label={type === "transfer" ? "Со счёта" : "Счёт"}>
              <Select value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
            </F>
            {type === "transfer" && (
              <F label="На счёт">
                <Select value={transferAccountId} onChange={setTransferAccountId} placeholder="— выберите —" options={[{ value: "", label: "— выберите —" }, ...accounts.filter((a) => a.id !== accountId).map((a) => ({ value: a.id, label: a.name }))]} />
              </F>
            )}
            {type !== "transfer" && (
              <F label="Статья">
                <Select value={categoryId} onChange={setCategoryId} placeholder="— без статьи —" options={[{ value: "", label: "— без статьи —" }, ...filteredCats.map((c) => ({ value: c.id, label: c.name }))]} />
              </F>
            )}
            {type !== "transfer" && (
              <F label="Контрагент">
                <Select value={counterpartyId} onChange={setCounterpartyId} placeholder="— не указан —" options={[{ value: "", label: "— не указан —" }, ...counterparties.map((c) => ({ value: c.id, label: c.name }))]} />
              </F>
            )}
            <F label="Проект">
              <Select value={projectId} onChange={setProjectId} placeholder="— без проекта —" options={[{ value: "", label: "— без проекта —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
            </F>
            <F label="Периодичность">
              <Select value={frequency} onChange={setFrequency} options={[{ value: "monthly", label: "Ежемесячно" }, { value: "weekly", label: "Еженедельно" }]} />
            </F>
            {frequency === "monthly" ? (
              <F label="День месяца">
                <input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className="input" />
              </F>
            ) : (
              <F label="День недели">
                <Select value={String(weekday)} onChange={(v) => setWeekday(Number(v))} options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))} />
              </F>
            )}
            <F label="Начало"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" /></F>
            <F label="Конец (необязательно)"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" /></F>
            <F label="Комментарий"><input value={note} onChange={(e) => setNote(e.target.value)} className="input" /></F>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить шаблон"}</button>
        </form>
      )}

      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Операция</th>
                <th className="px-5 py-3 font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Периодичность</th>
                <th className="px-5 py-3 font-medium">Счёт</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={`border-b border-slate-50 last:border-0 dark:border-white/[0.05] ${r.active ? "" : "opacity-50"}`}>
                  <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">
                    {r.type === "income" ? "Доход" : r.type === "expense" ? "Расход" : "Перевод"}
                    {catName(r.category_id) && <span className="ml-2 text-xs text-slate-400">· {catName(r.category_id)}</span>}
                    {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
                  </td>
                  <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">{formatMoney(r.amount, r.currency)}</td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{freqLabel(r)}</td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                    {accName(r.account_id)}{r.type === "transfer" && ` → ${accName(r.transfer_account_id)}`}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => toggleActive(r)} className="rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
                        {r.active ? "Пауза" : "Вкл"}
                      </button>
                      <button onClick={() => remove(r.id)} className="rounded-full px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Шаблонов пока нет. Добавьте регулярную операцию (аренда, оклад, подписка) — она будет
          автоматически попадать в плановые и в платёжный календарь.
        </p>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
