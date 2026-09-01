"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import { VAULT_ACTION_LABELS, type VaultGrant, type VaultLogRow } from "@/lib/vault";

type Member = { id: string; name: string };
type Opt = { value: string; label: string };

export default function VaultAccess({
  teamId,
  entryId,
  members,
  unitOptions,
  unitName,
  memberName,
  grants,
  log,
}: {
  teamId: string;
  entryId: string;
  members: Member[];
  unitOptions: Opt[];
  unitName: Record<string, string>;
  memberName: Record<string, string>;
  grants: VaultGrant[];
  log: VaultLogRow[];
}) {
  const router = useRouter();
  const [subjectType, setSubjectType] = useState<"user" | "unit">("user");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!target) {
      toast.error("Выберите, кому выдать доступ");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const row = {
      team_id: teamId,
      entry_id: entryId,
      subject_type: subjectType,
      user_id: subjectType === "user" ? target : null,
      unit_id: subjectType === "unit" ? target : null,
    };
    const { error } = await supabase.from("vault_grants").insert(row);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("vault_grants_entry") ? "Этому субъекту доступ уже выдан" : error.message);
      return;
    }
    toast.success("Доступ выдан");
    setTarget("");
    router.refresh();
  }

  async function revoke(g: VaultGrant) {
    const supabase = createClient();
    const { error } = await supabase.from("vault_grants").delete().eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Доступ снят");
    router.refresh();
  }

  const targetOptions = subjectType === "user" ? members.map((m) => ({ value: m.id, label: m.name })) : unitOptions;

  function grantLabel(g: VaultGrant): string {
    if (g.subject_type === "user") return memberName[g.user_id ?? ""] ?? "—";
    return unitName[g.unit_id ?? ""] ?? "—";
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Выдать доступ</h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block sm:w-44">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Кому</span>
            <Select
              value={subjectType}
              onChange={(v) => { setSubjectType(v as "user" | "unit"); setTarget(""); }}
              options={[{ value: "user", label: "Сотруднику" }, { value: "unit", label: "Узлу оргструктуры" }]}
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{subjectType === "user" ? "Сотрудник" : "Узел"}</span>
            <Select value={target} onChange={setTarget} placeholder="— выберите —" options={targetOptions} />
          </label>
          <button type="button" disabled={busy} onClick={add} className="btn-primary">{busy ? "…" : "Выдать"}</button>
        </div>
        {subjectType === "unit" && (
          <p className="mt-2 text-xs text-slate-400">Доступ к узлу распространяется на сам узел и все его подразделения.</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Кому доступно</h3>
        {grants.length > 0 ? (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.07]">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-700 dark:text-neutral-300">
                  <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {g.subject_type === "user" ? "Сотрудник" : "Узел"}
                  </span>
                  {grantLabel(g)}
                </span>
                <button type="button" onClick={() => revoke(g)} className="btn-ghost px-2 py-1 text-xs">Снять</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Доступ выдан только владельцу/админу и автору записи.</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Журнал доступа</h3>
        {log.length > 0 ? (
          <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {log.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 text-slate-500 dark:text-neutral-400">
                <span>
                  <span className="font-medium text-slate-700 dark:text-neutral-300">{VAULT_ACTION_LABELS[l.action]}</span>
                  {" · "}{memberName[l.user_id ?? ""] ?? "—"}
                </span>
                <span className="shrink-0 tabular-nums">{new Date(l.created_at).toLocaleString("ru-RU")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Событий пока нет.</p>
        )}
      </section>
    </div>
  );
}
