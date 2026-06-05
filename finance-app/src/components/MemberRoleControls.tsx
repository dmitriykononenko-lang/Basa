"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/types";

const EDITABLE_ROLES: AppRole[] = ["owner", "admin", "manager", "employee", "viewer"];

export default function MemberRoleControls({
  teamId,
  userId,
  currentRole,
}: {
  teamId: string;
  userId: string;
  currentRole: AppRole;
}) {
  const router = useRouter();
  const [role, setRole] = useState<AppRole>(currentRole);
  const [busy, setBusy] = useState(false);

  async function changeRole(next: AppRole) {
    setBusy(true);
    setRole(next);
    const supabase = createClient();
    await supabase
      .from("team_members")
      .update({ role: next })
      .eq("team_id", teamId)
      .eq("user_id", userId);
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить участника из команды?")) return;
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", userId);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <select
        value={role}
        disabled={busy}
        onChange={(e) => changeRole(e.target.value as AppRole)}
        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      >
        {EDITABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
      >
        Удалить
      </button>
    </div>
  );
}
