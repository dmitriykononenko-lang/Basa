"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { VIS_RESOURCES, CONFIGURABLE_ROLES, type VisResource } from "@/lib/visibility";

// Матрица «раздел × роль». owner видит всё всегда (не настраивается).
export default function VisibilitySettings({
  teamId,
  initial,
}: {
  teamId: string;
  initial: Record<string, AppRole[]>;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, Set<AppRole>>>(() => {
    const s: Record<string, Set<AppRole>> = {};
    for (const r of VIS_RESOURCES) s[r.key] = new Set(initial[r.key] ?? [...CONFIGURABLE_ROLES]);
    return s;
  });
  const [busy, setBusy] = useState(false);

  function toggle(res: VisResource, role: AppRole) {
    setState((prev) => {
      const next = new Set(prev[res]);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { ...prev, [res]: next };
    });
  }

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const rows = VIS_RESOURCES.map((r) => ({
      team_id: teamId,
      resource: r.key,
      // owner всегда включён.
      allowed_roles: ["owner", ...CONFIGURABLE_ROLES.filter((role) => state[r.key].has(role))],
    }));
    const { error } = await supabase.from("team_visibility").upsert(rows, { onConflict: "team_id,resource" });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Видимость сохранена");
    router.refresh();
  }

  return (
    <div className="surface overflow-hidden rounded-3xl">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left dark:border-white/[0.07]">
              <th className="px-5 py-3 font-medium text-slate-500 dark:text-neutral-400">Раздел</th>
              {CONFIGURABLE_ROLES.map((role) => (
                <th key={role} className="px-3 py-3 text-center font-medium text-slate-500 dark:text-neutral-400">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {VIS_RESOURCES.map((r) => (
              <tr key={r.key} className="border-b border-slate-50 last:border-0 dark:border-white/[0.04]">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-800 dark:text-neutral-100">{r.label}</div>
                  <div className="text-xs text-slate-400 dark:text-neutral-500">{r.desc}</div>
                </td>
                {CONFIGURABLE_ROLES.map((role) => (
                  <td key={role} className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={state[r.key].has(role)}
                      onChange={() => toggle(r.key, role)}
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-white/[0.07]">
        <p className="text-xs text-slate-400 dark:text-neutral-500">
          Владелец видит все разделы всегда. Остатки по счетам ограничиваются и на уровне базы данных.
        </p>
        <button type="button" onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
