"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [result, setResult] = useState<{ emailed: boolean; link: string; note: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setResult({ emailed: data.emailed, link: data.link, note: data.emailNote });
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
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
          <select value={role} onChange={(e) => setRole(e.target.value as AppRole)} className="input">
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Отправляем…" : "Пригласить"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>
      )}

      {result && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-neutral-800/50">
          {result.emailed ? (
            <p className="text-emerald-700 dark:text-emerald-300">
              ✓ Письмо с приглашением отправлено на почту.
            </p>
          ) : (
            <p className="text-slate-600 dark:text-neutral-300">
              Приглашение создано. Письмо не отправлено{result.note ? ` (${result.note})` : ""} —
              скопируйте ссылку и отправьте коллеге:
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={result.link} className="input flex-1 text-xs" />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(result.link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="btn-primary whitespace-nowrap"
            >
              {copied ? "Скопировано ✓" : "Копировать"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
