// Чистая часть «нераспределённых выплат» (без Supabase и алиасов — тестируется
// в unallocated-calc.test.mjs): сколько от фактической операции ещё не разнесено
// по обязательствам.
//
// После 0099 у каждой привязки с операцией есть payment_amount — сумма в валюте
// ОПЕРАЦИИ. Тогда остаток операции = t.amount − Σ payment_amount, без пересчёта
// валют (FX нужен только чтобы показать/сложить остатки в базовой валюте).
// Пока миграция не применена (или у старой строки payment_amount = null) —
// прежнее поведение: obligation_payments.amount считаем уже в базовой валюте
// и вычитаем из суммы операции, пересчитанной в базовую.

export type AllocationLink = {
  amount: number; // минорные, валюта обязательства
  payment_amount: number | null | undefined; // минорные, валюта операции (0099)
};

export type UnallocatedCalc = {
  paidBase: number; // сумма операции в базовой валюте
  allocatedBase: number; // разнесено, в базовой валюте
  remainingBase: number; // остаток, в базовой валюте
  /** Остаток в валюте операции; null — если хотя бы у одной привязки нет payment_amount. */
  remaining: number | null;
  /** true — остаток посчитан точно по payment_amount (без FX). */
  exact: boolean;
};

export function calcUnallocated(
  tx: { amount: number; currency: string },
  links: readonly AllocationLink[],
  toBase: (minor: number, currency: string) => number
): UnallocatedCalc {
  const paidBase = toBase(tx.amount, tx.currency);
  const exact = links.every((l) => l.payment_amount != null);

  if (exact) {
    const allocated = links.reduce((s, l) => s + Number(l.payment_amount), 0);
    const remaining = tx.amount - allocated;
    const remainingBase = toBase(remaining, tx.currency);
    return { paidBase, allocatedBase: paidBase - remainingBase, remainingBase, remaining, exact };
  }

  // Fallback (до 0099 / смешанные строки): payment_amount, где он есть, переводим
  // в базовую; иначе amount считаем уже базовой валютой (как было раньше).
  const allocatedBase = links.reduce(
    (s, l) => s + (l.payment_amount != null ? toBase(Number(l.payment_amount), tx.currency) : l.amount),
    0
  );
  return {
    paidBase,
    allocatedBase,
    remainingBase: paidBase - allocatedBase,
    remaining: null,
    exact,
  };
}

/** Есть ли что разносить: точный остаток > 0 в валюте операции, иначе > 0 в базовой. */
export function hasUnallocatedRemainder(c: UnallocatedCalc): boolean {
  return c.exact ? (c.remaining ?? 0) > 0 : c.remainingBase > 0;
}
