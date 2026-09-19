import Link from "next/link";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import ObsidianSettings from "@/components/ObsidianSettings";

export const dynamic = "force-dynamic";

export default async function ObsidianSettingsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return <div className="p-6 sm:p-8"><p className="text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду.</p></div>;
  }
  const manage = canEditFinance(current.role);
  const supabase = await createClient();
  const { data: conn } = await supabase
    .from("obsidian_connection")
    .select("token_hash, last_synced_at")
    .eq("team_id", current.team.id)
    .maybeSingle();

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://basefinance.pro";

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">← Настройки</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">База знаний · Obsidian</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">Двусторонняя синхронизация статей с хранилищем Obsidian (markdown)</p>
      </header>
      <ObsidianSettings
        manage={manage}
        connected={!!conn?.token_hash}
        lastSyncedAt={conn?.last_synced_at ? formatDate(conn.last_synced_at) : null}
        baseUrl={baseUrl}
      />
    </div>
  );
}
