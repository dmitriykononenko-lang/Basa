"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { salaryForMonth, type SalaryRate } from "@/lib/salary";
import { toast } from "@/lib/toast";

type Emp = { id: string; name: string; salaries: SalaryRate[] };

// «Начислить зарплату всем за месяц»: по окладу каждого сотрудника создаёт
// фиксированное начисление за выбранный месяц (пропуская уже начисленных).
export default function AccrueAllButton({ teamId, employees }: { teamId: string; employees: Emp[] }) {
  const router = useRouter();
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setLoading(true);
    const monthStart = `${month}-01`;
    const supabase = createClient();

    // Кандидаты: сотрудники с действующей ставкой на этот месяц
    const candidates = employees
      .map((e) => ({ id: e.id, rate: salaryForMonth(e.salaries, monthStart) }))
      .filter((c): c is { id: string; rate: SalaryRate } => c.rate !== null);

    if (candidates.length === 0) {
      setLoading(false);
      setError("Ни у кого нет оклада на этот месяц. Задайте ставки в карточках сотрудников.");
      return;
    }

    // Уже начисленные (fixed) за месяц — пропускаем
    const { data: existing, error: exErr } = await supabase
      .from("obligations")
      .select("counterparty_id")
      .eq("team_id", teamId)
      .eq("type", "payable")
      .eq("pay_part", "fixed")
      .eq("period_month", monthStart)
      .in("counterparty_id", candidates.map((c) => c.id));
    if (exErr) { setLoading(false); setError(exErr.message); return; }
    const done = new Set((existing ?? []).map((o) => o.counterparty_id as string));

    const payload = candidates
      .filter((c) => !done.has(c.id))
      .map((c) => ({
        team_id: teamId,
        counterparty_id: c.id,
        type: "payable" as const,
        amount: c.rate.amount,
        currency: c.rate.currency,
        due_date: monthStart,
        period_month: monthStart,
        pay_part: "fixed" as const,
        status: "open" as const,
        note: "Начисление ЗП",
      }));

    if (payload.length === 0) {
      setLoading(false);
      setOpen(false);
      toast.info("Все уже начислены за этот месяц");
      return;
    }

    const { error: insErr } = await supabase.from("obligations").insert(payload);
    setLoading(false);
    if (insErr) { setError(insErr.message); return; }
    setOpen(false);
    toast.success(`Начислено: ${payload.length}`);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        Начислить всем за месяц
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Месяц</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" />
      </div>
      <button onClick={run} disabled={loading} className="btn-primary">{loading ? "…" : "Начислить оклад"}</button>
      <button onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
