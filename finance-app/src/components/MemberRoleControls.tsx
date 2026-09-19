"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
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
      <Select
        variant="pill"
        value={role}
        disabled={busy}
        onChange={(v) => changeRole(v as AppRole)}
        options={EDITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
      />
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
