// Типы и хелперы модуля «Инвойсы» (счета на оплату).

export type InvoiceStatus = "draft" | "payment_waiting" | "paid" | "payment_expired" | "cancelled";
export type VatRate = "none" | "0" | "10" | "20";

export type InvoiceItem = {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;      // цена за единицу, минорные единицы, с НДС
  vat_rate: VatRate;
  amount: number;     // quantity * price, минорные
  sort: number;
};

export type Invoice = {
  id: string;
  number: string;
  counterparty_id: string | null;
  buyer_name: string;
  buyer_inn: string;
  buyer_kpp: string;
  project_id: string | null;
  currency: string;
  amount: number;
  vat_amount: number;
  purpose: string;
  issue_date: string;
  payment_expiry_date: string | null;
  status: InvoiceStatus;
  tochka_document_id: string | null;
  paid_on: string | null;
  note: string;
  created_at: string;
  // джойны для отображения
  project_name?: string | null;
  counterparty_name?: string | null;
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Черновик",
  payment_waiting: "Ожидает оплаты",
  paid: "Оплачен",
  payment_expired: "Просрочен",
  cancelled: "Отменён",
};

// Тон статуса для чипа (tailwind-классы фон/текст).
export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-neutral-300",
  payment_waiting: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  payment_expired: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  cancelled: "bg-slate-100 text-slate-400 line-through dark:bg-white/[0.04] dark:text-neutral-500",
};

export const VAT_LABELS: Record<VatRate, string> = {
  none: "Без НДС",
  "0": "0%",
  "10": "10%",
  "20": "20%",
};

// Сумма позиции (минорные): количество × цена. Количество может быть дробным.
export function itemAmount(quantity: number, priceMinor: number): number {
  return Math.round((Number.isFinite(quantity) ? quantity : 0) * priceMinor);
}

// НДС внутри суммы позиции (цена указана С НДС): amount * rate/(100+rate).
export function itemVat(amountMinor: number, rate: VatRate): number {
  if (rate === "none" || rate === "0") return 0;
  const r = Number(rate);
  return Math.round((amountMinor * r) / (100 + r));
}

// Итоги по позициям: общая сумма и НДС (минорные единицы).
export function invoiceTotals(items: { amount: number; vat_rate: VatRate }[]): { amount: number; vat_amount: number } {
  let amount = 0;
  let vat_amount = 0;
  for (const it of items) {
    amount += it.amount;
    vat_amount += itemVat(it.amount, it.vat_rate);
  }
  return { amount, vat_amount };
}

// «Индекс оплат»: доля оплаченных счетов среди выставленных (0–100), в процентах.
// Черновики и отменённые не учитываем.
export function paymentIndex(invoices: { status: InvoiceStatus }[]): number | null {
  const relevant = invoices.filter((i) => i.status !== "draft" && i.status !== "cancelled");
  if (relevant.length === 0) return null;
  const paid = relevant.filter((i) => i.status === "paid").length;
  return Math.round((paid / relevant.length) * 100);
}
