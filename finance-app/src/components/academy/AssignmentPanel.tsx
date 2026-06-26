"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import Modal from "@/components/Modal";
import { IconUsers } from "@/components/icons";
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
  void teamId;
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    setOpen(false);
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

  const targetOptions = type === "user" ? members.map((m) => ({ value: m.id, label: m.name })) : departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <section className="surface rounded-3xl p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Назначения</h2>
        <button type="button" onClick={() => setOpen(true)} className="btn-primary text-sm">+ Назначить</button>
      </div>

      {assignments.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.07]">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="flex items-center gap-2 text-slate-700 dark:text-neutral-300">
                <IconUsers className="h-4 w-4 text-slate-400" />
                <span>{a.assignee_type === "user" ? "Сотрудник" : "Отдел"}: <b>{a.label}</b></span>
                {a.due_date && <span className="text-xs text-slate-400">до {a.due_date}</span>}
              </span>
              <button type="button" onClick={() => removeAssignment(a.id)} className="btn-ghost text-sm">Снять</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Курс ещё никому не назначен.</p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Назначить курс" size="md">
        <div className="space-y-4">
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
                onClick={() => { setType(t); setTarget(""); }}
                className={`rounded-full px-3 py-1.5 font-medium transition ${type === t ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{type === "user" ? "Сотрудник" : "Отдел"}</span>
            <Select value={target} onChange={setTarget} placeholder="— выберите —" options={targetOptions} />
          </label>
          {type === "department" && departments.length === 0 && (
            <p className="text-xs text-amber-600">Отделы не созданы. Добавьте их и распределите сотрудников в разделе «База знаний → Отделы».</p>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дедлайн (необязательно)</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={assign} className="btn-primary">{busy ? "…" : "Назначить"}</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
