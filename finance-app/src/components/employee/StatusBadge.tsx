// Статус начисления по оплате: Ожидает / Частично / Погашено
export default function StatusBadge({ paid, amount }: { paid: number; amount: number }) {
  if (amount > 0 && paid >= amount) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        Погашено
      </span>
    );
  }
  if (paid > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        Частично
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
      Ожидает
    </span>
  );
}
