import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { ROLE_LABELS } from "@/lib/types";
import { emailConfigured } from "@/lib/email";
import ProfileForm from "@/components/profile/ProfileForm";
import ProfileSecurity from "@/components/profile/ProfileSecurity";
import NotificationPrefs from "@/components/profile/NotificationPrefs";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const current = await getCurrentTeam();
  const team = current?.team ?? null;
  const role = current?.role ?? null;

  const [{ data: profile }, prefsRes, cpRes] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", user.id).maybeSingle(),
    team
      ? supabase.from("notification_prefs").select("email_digest").eq("team_id", team.id).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    team
      ? supabase.from("counterparties").select("unit_id").eq("team_id", team.id).eq("user_id", user.id).contains("kinds", ["employee"]).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Название узла оргструктуры (если сотрудник привязан к учётке).
  let unitName: string | null = null;
  const unitId = (cpRes.data as { unit_id: string | null } | null)?.unit_id ?? null;
  if (team && unitId) {
    const { data: u } = await supabase.from("kb_departments").select("name").eq("id", unitId).maybeSingle();
    unitName = u?.name ?? null;
  }

  const displayName = profile?.full_name ?? user.email ?? "Пользователь";
  const emailDigest = (prefsRes.data as { email_digest: boolean } | null)?.email_digest ?? true;
  const emailReady = emailConfigured();

  return (
    <div className="mx-auto max-w-2xl p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Профиль</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Личные данные, доступ и уведомления</p>
      </header>

      <div className="space-y-4">
        <ProfileForm
          userId={user.id}
          teamId={team?.id ?? null}
          initialName={profile?.full_name ?? ""}
          initialAvatar={profile?.avatar_url ?? null}
        />

        <ProfileSecurity email={user.email ?? ""} />

        {team && (
          <NotificationPrefs userId={user.id} teamId={team.id} initialEnabled={emailDigest} emailReady={emailReady} />
        )}

        {/* Доступ (только просмотр) */}
        <div className="surface rounded-3xl p-6">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Доступ</h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Row label="Компания" value={team?.name ?? "—"} />
            <Row label="Роль" value={role ? ROLE_LABELS[role] : "—"} />
            <Row label="Подразделение" value={unitName ?? "—"} />
            <Row label="Имя" value={displayName} />
          </dl>
          {team && !unitId && (
            <p className="mt-3 text-xs text-slate-400 dark:text-neutral-500">
              Подразделение назначает администратор в разделе «Сотрудники → Оргструктура».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-white/[0.03]">
      <dt className="text-xs text-slate-400 dark:text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800 dark:text-neutral-200">{value}</dd>
    </div>
  );
}
