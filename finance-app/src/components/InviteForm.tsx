"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/types";

const INVITE_ROLES: AppRole[] = ["admin", "manager", "employee", "viewer"];

export default function InviteForm({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("employee");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.from("invites").insert({
      team_id: teamId,
      email: email.trim().toLowerCase(),
      role,
      invited_by: userId,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setEmail("");
    setOk(true);
    setLoading(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
    >
      <div className="min-w-[200px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Email участника
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com"
          className="input"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Роль
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AppRole)}
          className="input"
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "…" : "Пригласить"}
      </button>
      {ok && (
        <span className="text-sm text-emerald-600 dark:text-emerald-400">
          Приглашение создано
        </span>
      )}
      {error && (
        <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </form>
  );
}
