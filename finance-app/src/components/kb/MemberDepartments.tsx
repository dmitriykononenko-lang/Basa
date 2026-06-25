"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Member = { id: string; name: string };
type Dept = { id: string; name: string };

export default function MemberDepartments({
  teamId,
  departments,
  members,
  mappings,
}: {
  teamId: string;
  departments: Dept[];
  members: Member[];
  mappings: { department_id: string; user_id: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const set = new Set(mappings.map((m) => `${m.department_id}:${m.user_id}`));

  async function toggle(departmentId: string, userId: string, on: boolean) {
    const key = `${departmentId}:${userId}`;
    setBusy(key);
    const supabase = createClient();
    const { error } = on
      ? await supabase.from("kb_user_departments").delete().eq("department_id", departmentId).eq("user_id", userId)
      : await supabase.from("kb_user_departments").insert({ team_id: teamId, department_id: departmentId, user_id: userId });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Сотрудники по отделам</h2>
        <p className="text-xs text-slate-400">Распределение нужно, чтобы назначать курсы на отдел целиком.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {departments.map((d) => (
          <div key={d.id} className="surface rounded-3xl p-4">
            <h3 className="mb-2 font-medium text-slate-900 dark:text-white">{d.name}</h3>
            {members.length > 0 ? (
              <ul className="space-y-1.5">
                {members.map((m) => {
                  const key = `${d.id}:${m.id}`;
                  const on = set.has(key);
                  return (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-neutral-300">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy === key}
                          onChange={() => toggle(d.id, m.id, on)}
                          className="h-4 w-4 accent-brand"
                        />
                        {m.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">Нет сотрудников.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
