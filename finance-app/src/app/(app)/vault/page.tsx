import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance, canManageTeam } from "@/lib/team";
import { vaultKeyConfigured } from "@/lib/vault-crypto";
import VaultManager from "@/components/vault/VaultManager";
import type { VaultEntry, VaultGrant, VaultLogRow } from "@/lib/vault";

export default async function VaultPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Пароли</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;

  const header = (
    <header className="mb-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Пароли</h1>
      <p className="text-sm text-slate-500 dark:text-neutral-400">
        Зашифрованное хранилище паролей с контролируемой выдачей доступа и журналом показов
      </p>
    </header>
  );

  if (!vaultKeyConfigured()) {
    return (
      <div className="p-6 sm:p-8">
        {header}
        <div className="surface max-w-2xl rounded-3xl p-6">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Парольница не настроена</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            Чтобы включить раздел, добавьте секретный ключ шифрования <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">VAULT_KEY</code> в
            переменные окружения проекта (Vercel → Settings → Environment Variables), затем передеплойте.
          </p>
          <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">Сгенерировать ключ (32 байта):</p>
          <pre className="mt-1 overflow-x-auto rounded-2xl bg-slate-900 px-4 py-3 text-xs text-slate-100">openssl rand -hex 32</pre>
          <p className="mt-3 text-xs text-slate-400">
            Ключ хранится только в окружении сервера и в браузер не попадает. Без него пароли не расшифровать —
            в базе лежит только шифртекст.
          </p>
        </div>
      </div>
    );
  }

  const canManage = canEditFinance(role);
  const canGrant = canManageTeam(role);
  const supabase = await createClient();

  const { data: entriesRaw } = await supabase
    .from("vault_entries")
    .select("id, title, login, url, note, created_by, updated_at")
    .eq("team_id", team.id)
    .order("title");
  const entries = (entriesRaw ?? []) as VaultEntry[];

  // Данные управления доступом — только владельцу/админу (RLS их и не отдаст иначе).
  let members: { id: string; name: string }[] = [];
  let unitOptions: { value: string; label: string }[] = [];
  const unitName = new Map<string, string>();
  let grantsByEntry: Record<string, VaultGrant[]> = {};
  let logByEntry: Record<string, VaultLogRow[]> = {};

  if (canGrant) {
    const [{ data: membersRaw }, { data: unitsRaw }, { data: grantsRaw }, { data: logRaw }] = await Promise.all([
      supabase.from("team_members").select("user_id, profiles(full_name)").eq("team_id", team.id),
      supabase.from("kb_departments").select("id, name, parent_id, sort").eq("team_id", team.id),
      supabase.from("vault_grants").select("id, entry_id, subject_type, user_id, unit_id").eq("team_id", team.id),
      supabase.from("vault_access_log").select("id, entry_id, user_id, action, details, created_at").eq("team_id", team.id).order("created_at", { ascending: false }).limit(300),
    ]);

    members = ((membersRaw ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((m) => ({
      id: m.user_id,
      name: (Array.isArray(m.profiles) ? m.profiles[0]?.full_name : m.profiles?.full_name) || "Без имени",
    }));

    const units = (unitsRaw ?? []) as { id: string; name: string; parent_id: string | null; sort: number }[];
    for (const u of units) unitName.set(u.id, u.name);
    const childrenOf = new Map<string | null, typeof units>();
    for (const u of units) {
      const arr = childrenOf.get(u.parent_id) ?? [];
      arr.push(u);
      childrenOf.set(u.parent_id, arr);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    const walk = (pid: string | null, depth: number) => {
      for (const u of childrenOf.get(pid) ?? []) {
        unitOptions.push({ value: u.id, label: `${"— ".repeat(depth)}${u.name}` });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);

    grantsByEntry = {};
    for (const g of (grantsRaw ?? []) as VaultGrant[]) {
      (grantsByEntry[g.entry_id] ??= []).push(g);
    }
    logByEntry = {};
    for (const l of (logRaw ?? []) as VaultLogRow[]) {
      if (l.entry_id) (logByEntry[l.entry_id] ??= []).push(l);
    }
  }

  return (
    <div className="p-6 sm:p-8">
      {header}

      <details className="surface mb-5 rounded-3xl px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-900 dark:text-white">
          <span>Как пользоваться</span>
          <span className="text-xs font-normal text-slate-400">развернуть</span>
        </summary>
        <div className="mt-3 space-y-3 text-sm text-slate-600 dark:text-neutral-400">
          <p>
            Пароли шифруются на сервере и в браузер в открытом виде не попадают — в базе хранится только шифртекст.
            Каждый показ и изменение фиксируются в журнале.
          </p>
          <div>
            <div className="font-medium text-slate-700 dark:text-neutral-300">Кто что может</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Создавать и редактировать записи — менеджер, админ, владелец.</li>
              <li>Выдавать и снимать доступ — владелец и админ.</li>
              <li>«Показать» (расшифровать) — только по доступу: владелец/админ, автор записи, тот, кому выдан прямой доступ, либо чей узел оргструктуры покрыт выданным доступом.</li>
            </ul>
          </div>
          <div>
            <div className="font-medium text-slate-700 dark:text-neutral-300">Доступ «на узел»</div>
            <p className="mt-1">
              Доступ, выданный на узел оргструктуры, распространяется на сам узел и все его подразделения. Чтобы он
              сработал для человека, сотрудник должен быть привязан в разделе{" "}
              <a href="/employees?tab=org" className="font-medium text-brand hover:underline">Сотрудники → Оргструктура</a>{" "}
              к узлу и к учётной записи. Если привязки нет — выдавайте доступ напрямую сотруднику.
            </p>
          </div>
        </div>
      </details>

      <VaultManager
        teamId={team.id}
        entries={entries}
        canManage={canManage}
        canGrant={canGrant}
        members={members}
        unitOptions={unitOptions}
        unitName={Object.fromEntries(unitName)}
        grantsByEntry={grantsByEntry}
        logByEntry={logByEntry}
      />
    </div>
  );
}
