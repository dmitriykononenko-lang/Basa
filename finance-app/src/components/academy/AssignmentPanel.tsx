"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import type { AcademyAssigneeType } from "@/lib/academy";

type Member = { id: string; name: string };
type Dept = { id: string; name: string };
type Assignment = {
  id: string;
  assignee_type: AcademyAssigneeType;
  label: string;
  due_date: string | null;
};

export default function AssignmentPanel({
  teamId,
  courseId,
  members,
  departments,
  assignments,
}: {
  teamId: string;
  courseId: string;
  members: Member[];
  departments: Dept[];
  assignments: Assignment[];
}) {
  const router = useRouter();
  const [type, setType] = useState<AcademyAssigneeType>("user");
  const [target, setTarget] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!target) {
      toast.error("Выберите, кому назначить");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("academy_assign", {
      _course_id: courseId,
      _assignee_type: type,
      _department_id: type === "department" ? target : null,
      _user_id: type === "user" ? target : null,
      _due_date: due || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Назначено");
    setTarget("");
    setDue("");
    router.refresh();
  }

  async function removeAssignment(id: string) {
    if (!confirm("Снять назначение? Прогресс по нему сохранится.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("academy_assignments").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Снято");
    router.refresh();
  }

  const targetOptions =
    type === "user"
      ? members.map((m) => ({ value: m.id, label: m.name }))
      : departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <section className="surface space-y-4 rounded-3xl p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Назначение</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {(
            [
              ["user", "Сотруднику"],
              ["department", "Отделу"],
            ] as [AcademyAssigneeType, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setTarget("");
              }}
              className={`rounded-full px-3 py-1.5 font-medium transition ${
                type === t ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-w-[200px] flex-1">
          <Select value={target} onChange={setTarget} placeholder="— выберите —" options={targetOptions} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дедлайн (необяз.)</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input" />
        </div>
        <button type="button" disabled={busy} onClick={assign} className="btn-primary">
          {busy ? "…" : "Назначить"}
        </button>
      </div>

      {type === "department" && departments.length === 0 && (
        <p className="text-xs text-amber-600">Отделы не созданы. Добавьте их и распределите сотрудников в разделе «База знаний → Отделы».</p>
      )}

      {assignments.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.07]">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-slate-700 dark:text-neutral-300">
                {a.assignee_type === "user" ? "Сотрудник" : "Отдел"}: <b>{a.label}</b>
                {a.due_date && <span className="ml-2 text-xs text-slate-400">до {a.due_date}</span>}
              </span>
              <button type="button" onClick={() => removeAssignment(a.id)} className="btn-ghost text-sm">Снять</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
