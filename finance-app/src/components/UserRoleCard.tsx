"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type AppRole } from "@/lib/types";

const ROLES: AppRole[] = ["owner", "admin", "manager", "employee", "viewer"];

export default function UserRoleCard({
  teamId,
  userId,
  currentRole,
  isSelf,
}: {
  teamId: string;
  userId: string;
  currentRole: AppRole;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState<AppRole>(currentRole);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("team_members")
      .update({ role })
      .eq("team_id", teamId)
      .eq("user_id", userId);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить участника из команды?")) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", userId);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    router.push("/team");
    router.refresh();
  }

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        Уровень доступа
      </h2>
      <div className="space-y-2">
        {ROLES.map((r) => {
          const active = role === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                active
                  ? "border-brand bg-brand/5 dark:bg-brand/10"
                  : "border-slate-200 hover:bg-slate-50 dark:border-white/[0.08] dark:hover:bg-neutral-800/40"
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  active ? "border-brand" : "border-slate-300 dark:border-neutral-600"
                }`}
              >
                {active && <span className="h-2 w-2 rounded-full bg-brand" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800 dark:text-neutral-200">
                  {ROLE_LABELS[r]}
                </span>
                <span className="block text-xs text-slate-500 dark:text-neutral-400">
                  {ROLE_DESCRIPTIONS[r]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || role === currentRole}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
        {saved && role === currentRole && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">Сохранено</span>
        )}
        {!isSelf && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="ml-auto rounded-full px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
          >
            Удалить из команды
          </button>
        )}
      </div>
    </div>
  );
}
