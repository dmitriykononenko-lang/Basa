"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";

type Emp = { id: string; name: string; unit_id: string | null; user_id: string | null };
type Opt = { value: string; label: string };

export default function EmployeeOrgAssign({
  employees,
  unitOptions,
  members,
}: {
  employees: Emp[];
  unitOptions: Opt[];
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(empId: string, patch: { unit_id?: string | null; user_id?: string | null }, key: string) {
    setBusy(key);
    const supabase = createClient();
    const { error } = await supabase.from("counterparties").update(patch).eq("id", empId);
    setBusy(null);
    if (error) {
      toast.error(error.message.includes("counterparties_team_user_uniq") ? "Эта учётка уже привязана к другому сотруднику" : error.message);
      return;
    }
    router.refresh();
  }

  const unitOpts = [{ value: "", label: "— без узла —" }, ...unitOptions];
  const memberOpts = [{ value: "", label: "— нет доступа —" }, ...members.map((m) => ({ value: m.id, label: m.name }))];

  return (
    <section className="surface rounded-3xl p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Сотрудники: должность и доступ</h2>
      {employees.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-3">Сотрудник</th>
                <th className="py-2 pr-3">Узел оргструктуры</th>
                <th className="py-2 pr-3">Учётная запись (доступ)</th>
                <th className="py-2">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.07]">
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-3 font-medium text-slate-800 dark:text-neutral-200">{e.name}</td>
                  <td className="py-2 pr-3">
                    <div className="min-w-[220px]">
                      <Select value={e.unit_id ?? ""} onChange={(v) => patch(e.id, { unit_id: v || null }, `u-${e.id}`)} options={unitOpts} disabled={busy === `u-${e.id}`} />
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="min-w-[200px]">
                      <Select value={e.user_id ?? ""} onChange={(v) => patch(e.id, { user_id: v || null }, `a-${e.id}`)} options={memberOpts} disabled={busy === `a-${e.id}`} />
                    </div>
                  </td>
                  <td className="py-2">
                    {e.user_id ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">есть доступ</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">нет доступа</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Сотрудников нет.</p>
      )}
      <p className="mt-3 text-xs text-slate-400">«Доступ» — это связь сотрудника с учёткой, у которой есть вход в систему (из участников команды).</p>
    </section>
  );
}
