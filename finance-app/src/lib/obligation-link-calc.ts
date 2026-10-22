// Чистая математика привязки операции к начислению (без Supabase и алиасов —
// тестируется в obligation-link-calc.test.mjs). Контракт 0099:
//   obligation_payments.amount         — в валюте НАЧИСЛЕНИЯ;
//   obligation_payments.payment_amount — в валюте ОПЕРАЦИИ (у старых строк может быть null).
// Все суммы — целые минорные единицы.

export type ExistingLink = {
  amount: number; // валюта начисления
  payment_amount: number | null | undefined; // валюта операции
  oblCurrency: string | null; // валюта начисления этой привязки (null — начисление не прочитано)
  mine: boolean; // начисление этого же контрагента
};

/**
 * Сколько из привязки «съедено» от операции, в валюте операции.
 * null — нельзя посчитать без курса (старая строка без payment_amount, валюты разные).
 */
export function linkInTxCurrency(l: ExistingLink, txCurrency: string): number | null {
  if (l.payment_amount != null) return Number(l.payment_amount);
  if (l.oblCurrency === txCurrency) return Number(l.amount);
  return null;
}

/**
 * Непривязанный остаток кандидата в валюте операции:
 * min(часть контрагента − его привязки, вся операция − все привязки).
 * null — «нужна сверка»: у какой-то привязки нет суммы в валюте операции.
 */
export function candidateRemaining(
  tx: { part: number; whole: number; currency: string },
  links: readonly ExistingLink[],
): number | null {
  let all = 0;
  let mine = 0;
  for (const l of links) {
    const v = linkInTxCurrency(l, tx.currency);
    if (v === null) return null;
    all += v;
    if (l.mine) mine += v;
  }
  return Math.min(tx.part - mine, tx.whole - all);
}

/**
 * Курс «единиц валюты начисления за 1 единицу валюты операции» из курсов ЦБ
 * (рублей за 1 единицу каждой валюты; RUB = 1).
 */
export function crossRate(payRubPerUnit: number, oblRubPerUnit: number): number {
  return payRubPerUnit / oblRubPerUnit;
}

/**
 * Подсказка сумм для разновалютной привязки (обе валюты — в сотых):
 *   amount = min(round(available × rate), outstanding);
 *   если урезали до outstanding — payment = round(amount / rate) (не больше available).
 */
export function fxDefaults(available: number, outstanding: number, rate: number): { amount: number; payment: number } {
  const full = Math.round(available * rate);
  if (full <= outstanding) return { amount: full, payment: available };
  const payment = Math.min(available, Math.max(1, Math.round(outstanding / rate)));
  return { amount: outstanding, payment };
}

/** Сумма в валюте начисления по сумме операции и курсу. */
export function convertByRate(payment: number, rate: number): number {
  return Math.round(payment * rate);
}

/** «84,1975» — курс для подписи (до 4 знаков, без лишних нулей). */
export function formatRate(rate: number): string {
  return rate.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: rate < 1 ? 6 : 4 });
}

/** «21.09» (или «21.09.2025», если год не совпадает с текущим) из YYYY-MM-DD. */
export function formatRateDate(iso: string, currentYear = new Date().getFullYear()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return Number(m[1]) === currentYear ? `${m[3]}.${m[2]}` : `${m[3]}.${m[2]}.${m[1]}`;
}

export type FxMethod = "IDENTITY" | "CBR" | "MANUAL" | "LEGACY";

/** Подпись курса привязки: «по курсу 84,1975 (ЦБ 21.09)»; для IDENTITY — пусто. */
export function fxLabel(method: FxMethod | null | undefined, rate: number | null | undefined, rateDate: string | null | undefined): string {
  if (!method || method === "IDENTITY" || rate == null) return "";
  const r = formatRate(Number(rate));
  const d = rateDate ? formatRateDate(rateDate) : null;
  if (method === "CBR") return d ? `по курсу ${r} (ЦБ ${d})` : `по курсу ${r} (ЦБ)`;
  if (method === "MANUAL") return d ? `по курсу ${r} (вручную, ЦБ ${d})` : `по курсу ${r} (вручную)`;
  return `по курсу ${r} (исторический)`;
}
