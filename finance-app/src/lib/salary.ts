// Помощники по зарплате (без React/Supabase).

export type SalaryRate = { effective_from: string; amount: number; currency: string };

// Ставка оклада, действующая на начало указанного месяца (последняя по дате до monthStart).
// bounds (опц.): не начислять до месяца приёма (startDate) и после месяца увольнения (endDate).
export function salaryForMonth(
  salaries: SalaryRate[],
  monthStart: string,
  bounds?: { startDate?: string | null; endDate?: string | null },
): SalaryRate | null {
  const ym = monthStart.slice(0, 7);
  if (bounds?.endDate && bounds.endDate.slice(0, 7) < ym) return null; // уволен раньше этого месяца
  if (bounds?.startDate && bounds.startDate.slice(0, 7) > ym) return null; // ещё не вышел
  const eligible = salaries
    .filter((s) => s.effective_from <= monthStart)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return eligible[0] ?? null;
}
