"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import Combobox, { type ComboOption } from "@/components/Combobox";
import EmptyState from "@/components/EmptyState";
import { formatMoney, parseMoney } from "@/lib/format";
import {
  type Invoice, type InvoiceStatus, type VatRate, type CatalogItem,
  INVOICE_STATUS_LABELS, INVOICE_STATUS_TONE, VAT_LABELS,
  itemAmount, itemVat, invoiceTotals, paymentIndex,
} from "@/lib/invoices";
import ItemNameAutocomplete from "@/components/invoices/ItemNameAutocomplete";

export type { CatalogItem };

type Cp = { id: string; name: string; inn: string | null };
type Proj = { id: string; name: string };
type ItemDraft = { name: string; quantity: string; unit: string; price: string; vat_rate: VatRate };
type Draft = {
  id?: string;
  mode: "counterparty" | "manual";
  counterparty_id: string;
  buyer_name: string;
  buyer_inn: string;
  buyer_kpp: string;
  project_id: string;
  number: string;
  purpose: string;
  issue_date: string;
  payment_expiry_date: string;
  note: string;
  items: ItemDraft[];
};

// Строка быстрого (массового) ввода уже выставленных счетов — без позиций.
type BulkRow = { number: string; buyer_name: string; buyer_inn: string; amount: string; issue_date: string; payment_expiry_date: string };
const emptyBulkRow = (): BulkRow => ({ number: "", buyer_name: "", buyer_inn: "", amount: "", issue_date: new Date().toISOString().slice(0, 10), payment_expiry_date: "" });

const emptyItem = (): ItemDraft => ({ name: "", quantity: "1", unit: "шт", price: "", vat_rate: "none" });
const emptyDraft = (): Draft => ({
  mode: "counterparty", counterparty_id: "", buyer_name: "", buyer_inn: "", buyer_kpp: "",
  project_id: "", number: "", purpose: "", issue_date: new Date().toISOString().slice(0, 10),
  payment_expiry_date: "", note: "", items: [emptyItem()],
});

const STATUS_FILTERS: { value: "all" | InvoiceStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "payment_waiting", label: "Ожидают" },
  { value: "paid", label: "Оплачены" },
  { value: "payment_expired", label: "Просрочены" },
  { value: "draft", label: "Черновики" },
];

export default function InvoicesManager({
  teamId, invoices, counterparties, projects, catalog = [], nextByProject = {},
}: {
  teamId: string;
  invoices: Invoice[];
  counterparties: Cp[];
  projects: Proj[];
  catalog?: CatalogItem[];
  nextByProject?: Record<string, string>;
}) {
  void teamId;
  const router = useRouter();

  // Номер счёта следует за проектом: KO-NNN-INV-XX. Подставляем подсказку, если
  // поле пусто или содержит наш авто-формат (ручной номер не перетираем).
  function numberForProject(projectId: string, current: string): string {
    const auto = projectId ? nextByProject[projectId] : "";
    if (auto && (!current.trim() || /^KO-\d+-INV-\d+$/.test(current.trim()))) return auto;
    return current;
  }
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>("all");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([emptyBulkRow(), emptyBulkRow(), emptyBulkRow()]);

  const cpById = useMemo(() => new Map(counterparties.map((c) => [c.id, c])), [counterparties]);
  const index = paymentIndex(invoices);
  const unpaid = invoices.filter((i) => i.status === "payment_waiting" || i.status === "payment_expired");
  const unpaidSum = unpaid.reduce((s, i) => s + i.amount, 0);

  const shown = statusFilter === "all" ? invoices : invoices.filter((i) => i.status === statusFilter);

  function openCreate() { setDraft(emptyDraft()); setEditOpen(true); }
  async function openEdit(inv: Invoice) {
    // Подтягиваем позиции инвойса.
    const res = await fetch(`/api/invoices/${inv.id}/items`).catch(() => null);
    let items: ItemDraft[] = [emptyItem()];
    if (res && res.ok) {
      const j = await res.json().catch(() => ({ items: [] }));
      const rows = (j.items ?? []) as { name: string; quantity: number; unit: string; price: number; vat_rate: VatRate }[];
      if (rows.length) items = rows.map((r) => ({ name: r.name, quantity: String(r.quantity), unit: r.unit, price: (r.price / 100).toFixed(2).replace(".", ","), vat_rate: r.vat_rate }));
    }
    setDraft({
      id: inv.id,
      mode: inv.counterparty_id ? "counterparty" : "manual",
      counterparty_id: inv.counterparty_id ?? "",
      buyer_name: inv.buyer_name, buyer_inn: inv.buyer_inn, buyer_kpp: inv.buyer_kpp,
      project_id: inv.project_id ?? "", number: inv.number, purpose: inv.purpose,
      issue_date: inv.issue_date, payment_expiry_date: inv.payment_expiry_date ?? "",
      note: inv.note, items,
    });
    setEditOpen(true);
  }

  // Итоги черновика (для показа в форме).
  const draftItemsCalc = draft.items.map((it) => {
    const amount = itemAmount(Number(it.quantity.replace(",", ".")) || 0, parseMoney(it.price));
    return { amount, vat_rate: it.vat_rate };
  });
  const draftTotals = invoiceTotals(draftItemsCalc);

  function updItem(i: number, patch: Partial<ItemDraft>) {
    setDraft((d) => ({ ...d, items: d.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));
  }
  // Выбор позиции из справочника — подставляем наименование/ед./цену/НДС.
  function onItemPick(i: number, item: CatalogItem) {
    updItem(i, { name: item.name, unit: item.unit || "шт", price: (item.price / 100).toFixed(2).replace(".", ","), vat_rate: item.vat_rate });
  }
  function addItem() { setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] })); }
  function delItem(i: number) { setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, k) => k !== i) : d.items })); }

  async function save() {
    if (draft.mode === "counterparty" && !draft.counterparty_id) return toast.error("Выберите контрагента-плательщика");
    if (draft.mode === "manual" && !draft.buyer_name.trim()) return toast.error("Укажите название плательщика");
    const items = draft.items
      .map((it) => ({
        name: it.name.trim(),
        quantity: Number(it.quantity.replace(",", ".")) || 0,
        unit: it.unit.trim() || "шт",
        price: parseMoney(it.price),
        vat_rate: it.vat_rate,
      }))
      .filter((it) => it.price > 0 && it.quantity > 0);
    if (items.length === 0) return toast.error("Добавьте хотя бы одну позицию с ценой");

    setBusy(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: draft.id,
        number: draft.number,
        counterparty_id: draft.mode === "counterparty" ? draft.counterparty_id || null : null,
        buyer_name: draft.mode === "manual" ? draft.buyer_name : "",
        buyer_inn: draft.mode === "manual" ? draft.buyer_inn : "",
        buyer_kpp: draft.mode === "manual" ? draft.buyer_kpp : "",
        project_id: draft.project_id || null,
        purpose: draft.purpose,
        issue_date: draft.issue_date,
        payment_expiry_date: draft.payment_expiry_date || null,
        note: draft.note,
        items,
      }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось сохранить");
    toast.success("Инвойс сохранён");
    setEditOpen(false);
    router.refresh();
  }

  async function setStatus(inv: Invoice, status: InvoiceStatus) {
    const res = await fetch("/api/invoices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: inv.id, status }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось изменить статус");
    toast.success("Статус обновлён");
    router.refresh();
  }

  async function remove(inv: Invoice) {
    if (!confirm(`Удалить инвойс${inv.number ? ` №${inv.number}` : ""}? Действие необратимо.`)) return;
    const res = await fetch(`/api/invoices?id=${encodeURIComponent(inv.id)}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось удалить");
    toast.success("Удалено");
    router.refresh();
  }

  // ── Массовый ввод уже выставленных счетов ──────────────────────────────────
  function openBulk() { setBulkRows([emptyBulkRow(), emptyBulkRow(), emptyBulkRow()]); setBulkOpen(true); }
  function updBulk(i: number, patch: Partial<BulkRow>) {
    setBulkRows((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }
  function addBulkRow() { setBulkRows((rows) => [...rows, emptyBulkRow()]); }
  function delBulkRow(i: number) { setBulkRows((rows) => (rows.length > 1 ? rows.filter((_, k) => k !== i) : rows)); }

  // Вставка таблицы из буфера (Excel/Точка): колонки Номер, Плательщик, ИНН,
  // Сумма, Дата, Оплатить до — по табуляции. Строку-заголовок пропускаем.
  function onBulkPaste(e: React.ClipboardEvent, startIdx: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text || !/[\t\n]/.test(text)) return; // одиночная ячейка — обычная вставка
    e.preventDefault();
    const today = new Date().toISOString().slice(0, 10);
    const parsed = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length)
      .map((line) => line.split("\t"))
      .filter((c) => !/плательщик|сумма|номер счёт/i.test(c.join(" ")))
      .map((c): BulkRow => ({
        number: (c[0] ?? "").trim(),
        buyer_name: (c[1] ?? "").trim(),
        buyer_inn: (c[2] ?? "").replace(/\D/g, ""),
        amount: (c[3] ?? "").trim(),
        issue_date: normDate(c[4]) || today,
        payment_expiry_date: normDate(c[5]),
      }));
    if (parsed.length === 0) return;
    setBulkRows((rows) => {
      const next = [...rows];
      next.splice(startIdx, Math.max(1, parsed.length), ...parsed);
      return next;
    });
  }

  async function saveBulk() {
    const rows = bulkRows
      .map((r) => ({
        number: r.number.trim(),
        buyer_name: r.buyer_name.trim(),
        buyer_inn: r.buyer_inn.trim(),
        amount: parseMoney(r.amount),
        issue_date: r.issue_date || new Date().toISOString().slice(0, 10),
        payment_expiry_date: r.payment_expiry_date || null,
      }))
      .filter((r) => r.buyer_name.length > 0 && r.amount > 0);
    if (rows.length === 0) return toast.error("Заполните хотя бы одну строку: плательщик и сумма");

    setBusy(true);
    const res = await fetch("/api/invoices/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось сохранить");
    toast.success(`Заведено счетов: ${j.inserted ?? rows.length}`);
    setBulkOpen(false);
    router.refresh();
  }

  async function reconcile() {
    setBusy(true);
    const res = await fetch("/api/invoices/reconcile", { method: "POST" });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось сверить оплаты");
    toast.success((j.matched ?? 0) > 0 ? `Отмечено оплаченными: ${j.matched}` : "Новых оплат по приходу не найдено");
    router.refresh();
  }

  async function issueTochka(inv: Invoice) {
    if (!confirm(`Выставить счёт${inv.number ? ` №${inv.number}` : ""} в Точке?`)) return;
    setBusy(true);
    const res = await fetch(`/api/invoices/${inv.id}/issue`, { method: "POST" });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось выставить в Точке");
    toast.success("Счёт выставлен в Точке");
    router.refresh();
  }
  async function refreshTochka(inv: Invoice) {
    const res = await fetch(`/api/invoices/${inv.id}/tochka-status`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(j.error ?? "Не удалось получить статус из Точки");
    toast.success(`Статус из Точки: ${j.tochkaStatus || j.status}`);
    router.refresh();
  }

  return (
    <>
      {/* Сводка */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Всего инвойсов" value={String(invoices.length)} />
        <SummaryCard label="Не оплачено" value={formatMoney(unpaidSum, "RUB")} sub={`${unpaid.length} шт.`} tone="amber" />
        <SummaryCard label="Индекс оплат" value={index != null ? `${index}` : "—"} sub={index != null ? "% оплаченных" : "нет выставленных"} tone={index != null && index >= 70 ? "emerald" : "slate"} />
        <SummaryCard label="Оплачено" value={String(invoices.filter((i) => i.status === "paid").length)} tone="emerald" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${statusFilter === f.value ? "bg-brand/10 text-brand" : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/[0.04]"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={reconcile} disabled={busy} className="btn-ghost text-sm ring-1 ring-slate-200 dark:ring-white/10" title="Найти оплаты по входящим операциям (выписка Точки / BMI) и отметить счета оплаченными">
            Сверить оплаты
          </button>
          <button type="button" onClick={openBulk} className="btn-ghost text-sm ring-1 ring-slate-200 dark:ring-white/10" title="Быстро завести уже выставленные счета (напр. из веб-кабинета Точки): номер, плательщик, сумма, срок">
            Завести из Точки
          </button>
          <button type="button" onClick={openCreate} className="btn-primary text-sm">+ Инвойс</button>
        </div>
      </div>

      {invoices.length === 0 ? (
        <EmptyState icon="🧾" title="Инвойсов пока нет" description="Выставьте первый счёт клиенту: кнопка «+ Инвойс». Статусы оплаты можно подтягивать из Точки." />
      ) : shown.length === 0 ? (
        <EmptyState icon="🔍" title="Ничего не найдено" description="Измените фильтр статуса." />
      ) : (
        <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Номер</th>
                <th className="px-5 py-3 font-medium">Плательщик</th>
                <th className="px-5 py-3 font-medium">Проект</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 dark:border-white/[0.05] dark:hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">
                    {new Date(inv.issue_date).toLocaleDateString("ru-RU")}
                    {inv.payment_expiry_date && <div className="text-[11px] text-slate-400">до {new Date(inv.payment_expiry_date).toLocaleDateString("ru-RU")}</div>}
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{inv.number || "—"}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800 dark:text-neutral-100">{inv.counterparty_name ?? (inv.buyer_name || "—")}</div>
                    {inv.buyer_inn && <div className="text-xs text-slate-400">ИНН {inv.buyer_inn}</div>}
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{inv.project_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-slate-900 dark:text-white">
                    {formatMoney(inv.amount, inv.currency)}
                    {inv.vat_amount > 0 && <div className="text-[11px] font-normal text-slate-400">НДС {formatMoney(inv.vat_amount, inv.currency)}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_STATUS_TONE[inv.status]}`}>{INVOICE_STATUS_LABELS[inv.status]}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      {inv.currency === "RUB" && !inv.tochka_document_id && (
                        <button type="button" onClick={() => issueTochka(inv)} disabled={busy} className="btn-ghost px-2 py-1 text-xs text-brand" title="Создать счёт в Точке (для закрывающих документов)">В Точку</button>
                      )}
                      {inv.tochka_document_id && (
                        <button type="button" onClick={() => refreshTochka(inv)} className="btn-ghost px-2 py-1 text-xs" title="Обновить статус оплаты из Точки">Точка ⟳</button>
                      )}
                      {inv.status !== "paid" && (
                        <button type="button" onClick={() => setStatus(inv, "paid")} className="btn-ghost px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400">Оплачен</button>
                      )}
                      <button type="button" onClick={() => openEdit(inv)} className="btn-ghost px-2 py-1 text-xs">Изменить</button>
                      <button type="button" onClick={() => remove(inv)} className="btn-ghost px-2 py-1 text-xs text-red-500">Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Создание / редактирование */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={draft.id ? "Изменить инвойс" : "Новый инвойс"} size="wide">
        <div className="space-y-4">
          {/* Плательщик */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Плательщик">
              <div className="mb-2 flex gap-1 rounded-full bg-slate-100 p-0.5 text-xs dark:bg-neutral-800">
                <button type="button" onClick={() => setDraft({ ...draft, mode: "counterparty" })} className={`flex-1 rounded-full px-2 py-1 font-medium ${draft.mode === "counterparty" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>Из контрагентов</button>
                <button type="button" onClick={() => setDraft({ ...draft, mode: "manual" })} className={`flex-1 rounded-full px-2 py-1 font-medium ${draft.mode === "manual" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>Вручную</button>
              </div>
              {draft.mode === "counterparty" ? (
                <Combobox value={draft.counterparty_id} onChange={(v) => setDraft({ ...draft, counterparty_id: v, buyer_inn: cpById.get(v)?.inn ?? "" })}
                  placeholder="— выберите —" emptyLabel="— выберите —"
                  options={counterparties.map((c): ComboOption => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }))} />
              ) : (
                <div className="space-y-2">
                  <input value={draft.buyer_name} onChange={(e) => setDraft({ ...draft, buyer_name: e.target.value })} className="input" placeholder="Название плательщика" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={draft.buyer_inn} onChange={(e) => setDraft({ ...draft, buyer_inn: e.target.value })} className="input" placeholder="ИНН" inputMode="numeric" />
                    <input value={draft.buyer_kpp} onChange={(e) => setDraft({ ...draft, buyer_kpp: e.target.value })} className="input" placeholder="КПП (необяз.)" inputMode="numeric" />
                  </div>
                </div>
              )}
            </Field>
            <Field label="Проект (необяз.)">
              <Combobox value={draft.project_id} onChange={(v) => setDraft((d) => ({ ...d, project_id: v, number: numberForProject(v, d.number) }))} placeholder="— без проекта —" emptyLabel="— без проекта —"
                options={projects.map((p): ComboOption => ({ value: p.id, label: p.name }))} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Номер"><input value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} className="input" placeholder="KO-127-INV-01 (из проекта)" /></Field>
            <Field label="Дата счёта"><input type="date" value={draft.issue_date} onChange={(e) => setDraft({ ...draft, issue_date: e.target.value })} className="input" /></Field>
            <Field label="Оплатить до (необяз.)"><input type="date" value={draft.payment_expiry_date} onChange={(e) => setDraft({ ...draft, payment_expiry_date: e.target.value })} className="input" /></Field>
          </div>

          <Field label="Назначение платежа (необяз.)"><input value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} className="input" placeholder="Оплата услуг по договору…" /></Field>

          {/* Позиции */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-neutral-400">Позиции</span>
              <span className="text-xs text-slate-400">Итого: <b className="text-slate-700 dark:text-neutral-200">{formatMoney(draftTotals.amount, "RUB")}</b>{draftTotals.vat_amount > 0 ? ` · НДС ${formatMoney(draftTotals.vat_amount, "RUB")}` : ""}</span>
            </div>
            <div className="space-y-2">
              {draft.items.map((it, i) => {
                const amount = draftItemsCalc[i].amount;
                return (
                  <div key={i} className="grid grid-cols-1 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03] sm:grid-cols-12 sm:items-end">
                    <div className="sm:col-span-4">
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">Наименование</label>
                      <ItemNameAutocomplete
                        value={it.name}
                        onChange={(name) => updItem(i, { name })}
                        onPick={(c) => onItemPick(i, c)}
                        catalog={catalog}
                        className="input py-1.5 text-sm"
                        placeholder="Товар / услуга"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">Кол-во</label>
                      <input value={it.quantity} onChange={(e) => updItem(i, { quantity: e.target.value })} inputMode="decimal" className="input py-1.5 text-sm" />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">Ед.</label>
                      <input value={it.unit} onChange={(e) => updItem(i, { unit: e.target.value })} className="input py-1.5 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">Цена, ₽</label>
                      <input value={it.price} onChange={(e) => updItem(i, { price: e.target.value })} inputMode="decimal" placeholder="0,00" className="input py-1.5 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">НДС</label>
                      <select value={it.vat_rate} onChange={(e) => updItem(i, { vat_rate: e.target.value as VatRate })} className="input py-1.5 text-sm">
                        {(["none", "0", "10", "20"] as VatRate[]).map((r) => <option key={r} value={r}>{VAT_LABELS[r]}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:justify-end sm:pb-1.5">
                      <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-neutral-100">{formatMoney(amount, "RUB")}</span>
                      <button type="button" onClick={() => delItem(i)} disabled={draft.items.length <= 1} className="text-sm text-slate-400 hover:text-red-500 disabled:opacity-30">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addItem} className="mt-2 text-sm font-medium text-brand">+ Добавить позицию</button>
          </div>

          <Field label="Заметка (необяз.)"><input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="input" placeholder="Внутренний комментарий" /></Field>

          <p className="text-xs text-slate-400">Выставление счёта в Точке и подтяжка статуса оплаты подключаются отдельно (кнопка появится после привязки Точки).</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </Modal>

      {/* Массовый ввод уже выставленных счетов */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Завести выставленные счета" size="wide">
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Для счетов, уже выставленных в веб-кабинете Точки (списком через API банк их не отдаёт).
            Заполните строки или <b>вставьте таблицу из буфера</b> (Excel / выгрузка Точки): колонки —
            Номер, Плательщик, ИНН, Сумма ₽, Дата, Оплатить до. Статус — «ожидает оплаты»;
            «оплачен» проставится сверкой по приходу.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 dark:text-neutral-500">
                  <th className="px-2 py-1.5 font-medium">Номер</th>
                  <th className="px-2 py-1.5 font-medium">Плательщик *</th>
                  <th className="px-2 py-1.5 font-medium">ИНН</th>
                  <th className="px-2 py-1.5 text-right font-medium">Сумма ₽ *</th>
                  <th className="px-2 py-1.5 font-medium">Дата</th>
                  <th className="px-2 py-1.5 font-medium">Оплатить до</th>
                  <th className="px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><input value={r.number} onChange={(e) => updBulk(i, { number: e.target.value })} onPaste={(e) => onBulkPaste(e, i)} className="input py-1.5 text-sm" placeholder="2026-014" /></td>
                    <td className="px-1 py-1"><input value={r.buyer_name} onChange={(e) => updBulk(i, { buyer_name: e.target.value })} onPaste={(e) => onBulkPaste(e, i)} className="input py-1.5 text-sm" placeholder="ООО «Ромашка»" /></td>
                    <td className="px-1 py-1"><input value={r.buyer_inn} onChange={(e) => updBulk(i, { buyer_inn: e.target.value })} onPaste={(e) => onBulkPaste(e, i)} inputMode="numeric" className="input py-1.5 text-sm" placeholder="7700000000" /></td>
                    <td className="px-1 py-1"><input value={r.amount} onChange={(e) => updBulk(i, { amount: e.target.value })} onPaste={(e) => onBulkPaste(e, i)} inputMode="decimal" className="input py-1.5 text-right text-sm" placeholder="0,00" /></td>
                    <td className="px-1 py-1"><input type="date" value={r.issue_date} onChange={(e) => updBulk(i, { issue_date: e.target.value })} className="input py-1.5 text-sm" /></td>
                    <td className="px-1 py-1"><input type="date" value={r.payment_expiry_date} onChange={(e) => updBulk(i, { payment_expiry_date: e.target.value })} className="input py-1.5 text-sm" /></td>
                    <td className="px-1 py-1 text-center"><button type="button" onClick={() => delBulkRow(i)} disabled={bulkRows.length <= 1} className="text-slate-400 hover:text-red-500 disabled:opacity-30">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addBulkRow} className="text-sm font-medium text-brand">+ Строка</button>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setBulkOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={saveBulk} className="btn-primary">{busy ? "…" : "Завести счета"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// Нормализация даты из вставки: «16.08.2026» / «2026-08-16» / «16/08/2026» → ISO.
function normDate(v?: string): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return "";
}

function SummaryCard({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: "slate" | "amber" | "emerald" }) {
  const dot = { slate: "bg-slate-800 dark:bg-white", amber: "bg-amber-500", emerald: "bg-emerald-500" }[tone];
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.06]">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-neutral-400">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />{label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</div>
      <div className="mt-1 min-h-[1rem] text-xs text-slate-400 dark:text-neutral-500">{sub}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
