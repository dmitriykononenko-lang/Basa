"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney, formatDate } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";
import { Select } from "@/components/ui/select";
import Combobox from "@/components/Combobox";
import { toast } from "@/lib/toast";

export type DealView = {
  id: string;
  title: string;
  saleAmount: number;
  currency: string;
  soldOn: string;
  expectedCost: number | null;
  status: string;
  note: string | null;
  clientId: string | null;
  projectId: string | null;
  clientName: string | null;
  projectName: string | null;
  purchases: { id: string; amount: number; currency: string; purchased_on: string; vendorName: string | null; note: string | null; baseAmount: number; linked: boolean }[];
  payments: { id: string; amount: number; currency: string; paid_on: string; note: string | null; baseAmount: number; linked: boolean }[];
  items: { id: string; name: string; qty: number; plannedCost: number | null; isPurchased: boolean }[];
  itemsPlannedTotal: number | null;
  saleBase: number;
  purchasedBase: number;
  receivedBase: number;
  receivableBase: number;
  expectedBase: number | null;
  remaining: number | null;
  marginBase: number;
  isOpen: boolean;
  fullyPurchased: boolean;
};

export type OpOption = {
  id: string; amount: number; currency: string; occurred_on: string;
  counterpartyId: string | null; counterpartyName: string | null;
};

type Named = { id: string; name: string };

const TABS: { key: string; label: string }[] = [
  { key: "open", label: "Открытые" },
  { key: "closed", label: "Закрытые" },
  { key: "all", label: "Все" },
];

export default function LicensesView({
  deals, counterparties, projects, incomeOps, expenseOps, teamId, userId, base, canEdit,
}: {
  deals: DealView[];
  counterparties: Named[];
  projects: Named[];
  incomeOps: OpOption[];
  expenseOps: OpOption[];
  teamId: string;
  userId: string;
  base: string;
  canEdit: boolean;
}) {
  const [tab, setTab] = useState("open");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return deals.filter((d) => {
      const tabOk = tab === "all" ? true : tab === "open" ? d.isOpen : !d.isOpen;
      const text = `${d.title} ${d.clientName ?? ""} ${d.projectName ?? ""}`.toLowerCase();
      return tabOk && (!ql || text.includes(ql));
    });
  }, [deals, tab, q]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {TABS.map((t) => {
            const n = t.key === "open" ? deals.filter((d) => d.isOpen).length : t.key === "closed" ? deals.filter((d) => !d.isOpen).length : deals.length;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`rounded-full px-3.5 py-1.5 font-medium transition ${tab === t.key ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}>
                {t.label} <span className="text-slate-400">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" className="input w-48 py-1.5 text-sm" />
          {canEdit && <button onClick={() => setAdding((a) => !a)} className="btn-primary">+ Сделка</button>}
        </div>
      </div>

      {adding && canEdit && (
        <AddDealForm
          counterparties={counterparties} projects={projects} incomeOps={incomeOps} teamId={teamId} userId={userId} base={base}
          onDone={() => setAdding(false)}
        />
      )}

      {filtered.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          {deals.length === 0 ? "Пока нет сделок. Создайте первую кнопкой «+ Сделка»." : "Нет сделок по фильтру."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
            <DealCard key={d.id} deal={d} base={base} teamId={teamId} userId={userId} canEdit={canEdit}
              counterparties={counterparties} expenseOps={expenseOps} incomeOps={incomeOps} open={expanded.has(d.id)} onToggle={() => toggle(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function statusPill(d: DealView): { label: string; cls: string } {
  if (!d.isOpen) return { label: "Закрыта", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (d.purchasedBase > 0) return { label: "Частично закуплена", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  return { label: "Не закуплена", cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };
}

function DealCard({
  deal, base, teamId, userId, canEdit, counterparties, expenseOps, incomeOps, open, onToggle,
}: {
  deal: DealView; base: string; teamId: string; userId: string; canEdit: boolean;
  counterparties: Named[]; expenseOps: OpOption[]; incomeOps: OpOption[]; open: boolean; onToggle: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [addPay, setAddPay] = useState(false);
  const [addBuy, setAddBuy] = useState(false);
  const pill = statusPill(deal);
  const payPct = deal.saleBase > 0 ? (deal.receivedBase / deal.saleBase) * 100 : 0;
  const buyPct = deal.expectedBase && deal.expectedBase > 0
    ? (deal.purchasedBase / deal.expectedBase) * 100
    : 0; // без плана закупки прогресс не от чего считать — полоса пустая, сумма видна в подписи

  async function closeToggle() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("license_deals").update({ status: deal.status === "closed" ? "open" : "closed" }).eq("id", deal.id);
    setBusy(false);
    toast.success(deal.status === "closed" ? "Сделка открыта" : "Сделка закрыта");
    router.refresh();
  }
  async function removeDeal() {
    if (!confirm("Удалить сделку со всеми закупками?")) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("license_deals").delete().eq("id", deal.id);
    setBusy(false);
    toast.success("Сделка удалена");
    router.refresh();
  }
  async function removePurchase(id: string) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("license_purchases").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }
  async function removePayment(id: string) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("license_payments").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={`rounded-3xl bg-white ring-1 transition dark:bg-[#15171c] ${deal.isOpen && deal.purchasedBase === 0 ? "ring-amber-200/70 dark:ring-amber-500/20" : "ring-slate-200/80 dark:ring-white/[0.07]"}`}>
      <button onClick={onToggle} className="flex w-full flex-col gap-3.5 rounded-3xl p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
        {/* Шапка: название + статус + сумма продажи */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">{deal.title}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pill.cls}`}>{pill.label}</span>
            </div>
            <div className="mt-1 truncate text-xs text-slate-400 dark:text-neutral-500">
              {deal.clientName ?? "без клиента"}{deal.projectName && <> · {deal.projectName}</>} · {formatDate(deal.soldOn)}
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-neutral-500">Продажа</div>
              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(deal.saleAmount, deal.currency)}</div>
              {deal.currency !== base && <div className="text-[10px] tabular-nums text-slate-400">≈ {formatMoney(deal.saleBase, base)}</div>}
            </div>
            <span className={`mt-1 text-slate-300 transition ${open ? "rotate-180" : ""}`}>▾</span>
          </div>
        </div>

        {/* Прогресс: оплата клиента и закупка — наглядно полосами */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-neutral-400">Оплата клиента</span>
              <span className="tabular-nums">
                {deal.receivableBase > 0
                  ? <span className="text-slate-500 dark:text-neutral-400">{formatMoney(deal.receivedBase, base)} <span className="text-slate-400">/ {formatMoney(deal.saleBase, base)}</span></span>
                  : <span className="font-medium text-emerald-600 dark:text-emerald-400">оплачено полностью</span>}
              </span>
            </div>
            <Bar pct={payPct} tone={deal.receivableBase > 0 ? "amber" : "emerald"} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-neutral-400">Закупка у вендора</span>
              <span className="tabular-nums text-slate-500 dark:text-neutral-400">
                {deal.expectedBase != null
                  ? <>{formatMoney(deal.purchasedBase, base)} <span className="text-slate-400">/ {formatMoney(deal.expectedBase, base)}</span></>
                  : <>{formatMoney(deal.purchasedBase, base)} <span className="text-slate-400">· план не задан</span></>}
              </span>
            </div>
            <Bar pct={buyPct} tone={deal.fullyPurchased ? "emerald" : "brand"} />
          </div>
        </div>

        {/* Маржа + остаток закупки */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 dark:text-neutral-500">Маржа</span>
          <span className={`font-semibold tabular-nums ${deal.marginBase < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {formatMoney(deal.marginBase, base)}
          </span>
          {deal.remaining != null && deal.remaining > 0 && (
            <span className="ml-auto text-slate-400 dark:text-neutral-500">осталось закупить {formatMoney(deal.remaining, base)}</span>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 py-4 dark:border-white/[0.06]">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Позиции сделки</div>
          <DealItems deal={deal} teamId={teamId} userId={userId} canEdit={canEdit} />

          <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Оплаты клиента</div>
          {deal.payments.length > 0 ? (
            <ul className="mb-3 space-y-1.5 text-sm">
              {deal.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
                  <span className="text-slate-600 dark:text-neutral-300">
                    {p.linked && <span title="Привязана к операции">🔗 </span>}
                    {formatDate(p.paid_on)}{p.note && <span className="text-slate-400"> · {p.note}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <b className="text-emerald-600 dark:text-emerald-400">{formatMoney(p.amount, p.currency)}</b>
                      {p.currency !== base && <span className="block text-[10px] text-slate-400">≈ {formatMoney(p.baseAmount, base)}</span>}
                    </span>
                    {canEdit && <button onClick={() => removePayment(p.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-500" title="Удалить">✕</button>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-slate-400">Оплат ещё нет.</p>
          )}
          {canEdit && (addPay ? (
            <AddPaymentForm dealId={deal.id} teamId={teamId} userId={userId} defaultCurrency={deal.currency} incomeOps={incomeOps} onClose={() => setAddPay(false)} />
          ) : (
            <button onClick={() => setAddPay(true)} className="text-xs font-medium text-brand transition hover:opacity-80">+ Добавить оплату</button>
          ))}

          <div className="mb-2 mt-5 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Закупки у вендора</span>
            {deal.itemsPlannedTotal != null ? (
              <span className="text-xs text-slate-500 dark:text-neutral-400">План из позиций: {formatMoney(deal.itemsPlannedTotal, deal.currency)}</span>
            ) : (
              canEdit && <PlannedCostEditor dealId={deal.id} expectedCost={deal.expectedCost} currency={deal.currency} />
            )}
          </div>
          {deal.purchases.length > 0 ? (
            <ul className="mb-3 space-y-1.5 text-sm">
              {deal.purchases.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
                  <span className="text-slate-600 dark:text-neutral-300">
                    {p.linked && <span title="Привязана к операции">🔗 </span>}
                    {formatDate(p.purchased_on)}{p.vendorName && <> · {p.vendorName}</>}{p.note && <span className="text-slate-400"> · {p.note}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <b className="text-slate-800 dark:text-neutral-100">{formatMoney(p.amount, p.currency)}</b>
                      {p.currency !== base && <span className="block text-[10px] text-slate-400">≈ {formatMoney(p.baseAmount, base)}</span>}
                    </span>
                    {canEdit && <button onClick={() => removePurchase(p.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-500" title="Удалить">✕</button>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-slate-400">Закупок ещё нет.</p>
          )}

          {canEdit && (addBuy ? (
            <AddPurchaseForm dealId={deal.id} teamId={teamId} userId={userId} defaultCurrency={deal.currency} counterparties={counterparties} expenseOps={expenseOps} onClose={() => setAddBuy(false)} />
          ) : (
            <button onClick={() => setAddBuy(true)} className="text-xs font-medium text-brand transition hover:opacity-80">+ Добавить закупку</button>
          ))}

          {canEdit && (
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
              <button onClick={closeToggle} disabled={busy} className="btn-ghost text-sm">
                {deal.status === "closed" ? "Открыть сделку" : "Закрыть сделку"}
              </button>
              <button onClick={removeDeal} disabled={busy} className="ml-auto rounded-full px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10">
                Удалить сделку
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone: "emerald" | "brand" | "amber" }) {
  const bg = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-brand";
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.08]">
      <div className={`h-full rounded-full ${bg} transition-all`} style={{ width: `${w}%` }} />
    </div>
  );
}

function AddDealForm({
  counterparties, projects, incomeOps, teamId, userId, base, onDone,
}: {
  counterparties: Named[]; projects: Named[]; incomeOps: OpOption[]; teamId: string; userId: string; base: string; onDone: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [sale, setSale] = useState("");
  const [currency, setCurrency] = useState(base);
  const [soldOn, setSoldOn] = useState(today);
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [incomeTxId, setIncomeTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opById = useMemo(() => new Map(incomeOps.map((o) => [o.id, o])), [incomeOps]);
  function pickOp(id: string) {
    setIncomeTxId(id);
    const o = opById.get(id);
    if (!o) return;
    setSale(toAmountStr(o.amount));
    setCurrency(o.currency);
    setSoldOn(o.occurred_on);
    if (o.counterpartyId) setClientId(o.counterpartyId);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Укажите название");
    setBusy(true); setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.from("license_deals").insert({
      team_id: teamId,
      created_by: userId,
      title: title.trim(),
      client_counterparty_id: clientId || null,
      project_id: projectId || null,
      sale_amount: sale.trim() ? parseMoney(sale) : 0,
      currency,
      sold_on: soldOn,
      expected_cost: expected.trim() ? parseMoney(expected) : null,
      note: note.trim() || null,
    }).select("id").single();
    if (error || !data) { setBusy(false); return setError(error?.message ?? "Не удалось создать сделку"); }
    // Привязанная операция дохода становится первой оплатой клиента
    if (incomeTxId) {
      await supabase.from("license_payments").insert({
        team_id: teamId, deal_id: data.id, created_by: userId,
        amount: sale.trim() ? parseMoney(sale) : 0, currency, paid_on: soldOn,
        income_transaction_id: incomeTxId,
      });
    }
    setBusy(false);
    toast.success("Сделка добавлена");
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mb-4 space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      {incomeOps.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Из операции (поступление от клиента)</label>
          <Combobox value={incomeTxId} onChange={pickOp} placeholder="— ввести вручную —" emptyLabel="— ввести вручную —"
            options={incomeOps.map((o) => ({ value: o.id, label: opLabel(o) }))} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <F label="Что продали" wide>
          <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="напр. amoCRM 10 лиц., 1 год" className="input" />
        </F>
        <F label="Клиент">
          <Combobox value={clientId} onChange={setClientId} placeholder="— не выбран —" emptyLabel="— не выбран —"
            options={counterparties.map((c) => ({ value: c.id, label: c.name }))} />
        </F>
        <F label="Проект">
          <Combobox value={projectId} onChange={setProjectId} placeholder="— не выбран —" emptyLabel="— не выбран —"
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </F>
        <F label="Цена продажи">
          <div className="flex gap-2">
            <input value={sale} onChange={(e) => setSale(e.target.value)} inputMode="decimal" placeholder="0,00" className="input" />
            <Select className="w-24" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </div>
        </F>
        <F label="Ожидаемая закупка (опц.)">
          <input value={expected} onChange={(e) => setExpected(e.target.value)} inputMode="decimal" placeholder="оценка, можно позже" className="input" />
        </F>
        <F label="Дата продажи">
          <input type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} className="input" />
        </F>
        <F label="Заметка" wide>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="комментарий" className="input" />
        </F>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
        <button type="button" onClick={onDone} className="btn-ghost">Отмена</button>
      </div>
    </form>
  );
}

function AddPaymentForm({
  dealId, teamId, userId, defaultCurrency, incomeOps, onClose,
}: {
  dealId: string; teamId: string; userId: string; defaultCurrency: string; incomeOps: OpOption[]; onClose?: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [incomeTxId, setIncomeTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opById = useMemo(() => new Map(incomeOps.map((o) => [o.id, o])), [incomeOps]);
  function pickOp(id: string) {
    setIncomeTxId(id);
    const o = opById.get(id);
    if (!o) return;
    setAmount(toAmountStr(o.amount));
    setCurrency(o.currency);
    setPaidOn(o.occurred_on);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму оплаты");
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("license_payments").insert({
      team_id: teamId, deal_id: dealId, created_by: userId,
      amount: minor, currency, paid_on: paidOn,
      income_transaction_id: incomeTxId || null, note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setAmount(""); setNote(""); setIncomeTxId("");
    toast.success("Оплата добавлена");
    router.refresh();
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
      {incomeOps.length > 0 && (
        <div className="min-w-[200px] flex-1 basis-full">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Из операции (поступление от клиента)</label>
          <Combobox value={incomeTxId} onChange={pickOp} placeholder="— ввести вручную —" emptyLabel="— ввести вручную —"
            options={incomeOps.map((o) => ({ value: o.id, label: opLabel(o) }))} />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Сумма оплаты</label>
        <div className="flex gap-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32 py-1.5 text-sm" />
          <Select className="w-20" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата</label>
        <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="input w-40 py-1.5 text-sm" />
      </div>
      <div className="min-w-[140px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Заметка</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="комментарий" className="input py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={busy} className="rounded-full bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "…" : "+ Оплата"}</button>
      {onClose && <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm font-medium text-slate-400 transition hover:text-slate-600 dark:hover:text-neutral-300">Скрыть</button>}
      {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}

function DealItems({
  deal, teamId, userId, canEdit,
}: {
  deal: DealView; teamId: string; userId: string; canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, val: boolean) {
    const supabase = createClient();
    await supabase.from("license_deal_items").update({ is_purchased: val }).eq("id", id);
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("license_deal_items").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Укажите название позиции");
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("license_deal_items").insert({
      team_id: teamId, deal_id: deal.id, created_by: userId,
      name: name.trim(),
      qty: Math.max(1, parseInt(qty, 10) || 1),
      planned_cost: plan.trim() ? parseMoney(plan) : null,
      sort: deal.items.length,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setName(""); setQty("1"); setPlan("");
    toast.success("Позиция добавлена");
    router.refresh();
  }

  return (
    <>
      {deal.items.length > 0 ? (
        <ul className="mb-3 space-y-1.5 text-sm">
          {deal.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
              <label className="flex min-w-0 flex-1 items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={it.isPurchased}
                  disabled={!canEdit || busy}
                  onChange={(e) => toggle(it.id, e.target.checked)}
                  className="size-4 shrink-0 accent-emerald-600"
                />
                <span className={`truncate ${it.isPurchased ? "text-slate-400 line-through dark:text-neutral-500" : "text-slate-700 dark:text-neutral-200"}`}>
                  {it.name}{it.qty > 1 && <span className="text-slate-400"> ×{it.qty}</span>}
                </span>
              </label>
              <span className="flex shrink-0 items-center gap-3">
                <span className="tabular-nums text-slate-500 dark:text-neutral-400">
                  {it.plannedCost != null ? formatMoney(it.plannedCost, deal.currency) : "—"}
                </span>
                {canEdit && <button onClick={() => remove(it.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-500" title="Удалить позицию">✕</button>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-400">Позиций ещё нет.</p>
      )}

      {deal.itemsPlannedTotal != null && (
        <div className="mb-3 flex justify-between rounded-xl bg-slate-100/60 px-3 py-1.5 text-sm font-medium dark:bg-white/[0.04]">
          <span className="text-slate-500 dark:text-neutral-400">Итого план закупки</span>
          <span className="tabular-nums text-slate-700 dark:text-neutral-100">{formatMoney(deal.itemsPlannedTotal, deal.currency)}</span>
        </div>
      )}

      {canEdit && (adding ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Позиция</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. amoCRM 5 польз." className="input py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Кол-во</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="input w-20 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">План закупки</label>
            <input value={plan} onChange={(e) => setPlan(e.target.value)} inputMode="decimal" placeholder="0,00 (опц.)" className="input w-36 py-1.5 text-sm" />
          </div>
          <button type="submit" disabled={busy} className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "…" : "+ Позиция"}</button>
          <button type="button" onClick={() => setAdding(false)} className="rounded-full px-3 py-2 text-sm font-medium text-slate-400 transition hover:text-slate-600 dark:hover:text-neutral-300">Скрыть</button>
          {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs font-medium text-brand transition hover:opacity-80">+ Добавить позицию</button>
      ))}
    </>
  );
}

function PlannedCostEditor({
  dealId, expectedCost, currency,
}: {
  dealId: string; expectedCost: number | null; currency: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(expectedCost != null ? toAmountStr(expectedCost) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const minor = value.trim() ? parseMoney(value) : null;
    const { error } = await supabase.from("license_deals").update({ expected_cost: minor }).eq("id", dealId);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setEditing(false);
    toast.success("План закупки обновлён");
    router.refresh();
  }
  function cancel() {
    setValue(expectedCost != null ? toAmountStr(expectedCost) : "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-full px-2 py-0.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200"
      >
        План: {expectedCost != null ? formatMoney(expectedCost, currency) : "не задан"} ✎
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
        inputMode="decimal"
        placeholder="0,00"
        className="input w-28 py-1 text-sm"
      />
      <button type="button" onClick={save} disabled={busy} className="rounded-full px-2 py-1 text-sm text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-500/10" title="Сохранить">✓</button>
      <button type="button" onClick={cancel} disabled={busy} className="rounded-full px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]" title="Отмена">✕</button>
    </span>
  );
}

function AddPurchaseForm({
  dealId, teamId, userId, defaultCurrency, counterparties, expenseOps, onClose,
}: {
  dealId: string; teamId: string; userId: string; defaultCurrency: string; counterparties: Named[]; expenseOps: OpOption[]; onClose?: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [purchasedOn, setPurchasedOn] = useState(today);
  const [vendorId, setVendorId] = useState("");
  const [note, setNote] = useState("");
  const [expenseTxId, setExpenseTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opById = useMemo(() => new Map(expenseOps.map((o) => [o.id, o])), [expenseOps]);
  function pickOp(id: string) {
    setExpenseTxId(id);
    const o = opById.get(id);
    if (!o) return;
    setAmount(toAmountStr(o.amount));
    setCurrency(o.currency);
    setPurchasedOn(o.occurred_on);
    if (o.counterpartyId) setVendorId(o.counterpartyId);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму закупки");
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("license_purchases").insert({
      team_id: teamId,
      deal_id: dealId,
      created_by: userId,
      amount: minor,
      currency,
      purchased_on: purchasedOn,
      vendor_counterparty_id: vendorId || null,
      expense_transaction_id: expenseTxId || null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setAmount(""); setNote(""); setVendorId(""); setExpenseTxId("");
    toast.success("Закупка добавлена");
    router.refresh();
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
      {expenseOps.length > 0 && (
        <div className="min-w-[200px] flex-1 basis-full">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Из операции (закупка у вендора)</label>
          <Combobox value={expenseTxId} onChange={pickOp} placeholder="— ввести вручную —" emptyLabel="— ввести вручную —"
            options={expenseOps.map((o) => ({ value: o.id, label: opLabel(o) }))} />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Сумма закупки</label>
        <div className="flex gap-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32 py-1.5 text-sm" />
          <Select className="w-20" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата</label>
        <input type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} className="input w-40 py-1.5 text-sm" />
      </div>
      <div className="min-w-[180px]">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Вендор</label>
        <Combobox value={vendorId} onChange={setVendorId} placeholder="— не выбран —" emptyLabel="— не выбран —"
          options={counterparties.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      <div className="min-w-[140px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Заметка</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="комментарий" className="input py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={busy} className="rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "…" : "+ Закупка"}</button>
      {onClose && <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm font-medium text-slate-400 transition hover:text-slate-600 dark:hover:text-neutral-300">Скрыть</button>}
      {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}

function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-1" : ""}>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

function toAmountStr(minor: number): string {
  return (minor / 100).toFixed(2).replace(".", ",");
}
function opLabel(o: OpOption): string {
  return `${formatDate(o.occurred_on)} · ${formatMoney(o.amount, o.currency)}${o.counterpartyName ? ` · ${o.counterpartyName}` : ""}`;
}
