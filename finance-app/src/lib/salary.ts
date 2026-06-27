// Помощники по зарплате (без React/Supabase).

export type SalaryRate = { effective_from: string; amount: number; currency: string };

// Ставка оклада, действующая на начало указанного месяца (последняя по дате до monthStart).
export function salaryForMonth(salaries: SalaryRate[], monthStart: string): SalaryRate | null {
  const eligible = salaries
    .filter((s) => s.effective_from <= monthStart)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return eligible[0] ?? null;
}
