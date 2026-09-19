import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import CourseEditor from "@/components/academy/CourseEditor";
import type { KbKind } from "@/lib/kb";

export default async function NewCoursePage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/academy");
  const { team, role } = current;
  if (!canEditFinance(role)) redirect("/academy");

  const supabase = await createClient();
  const { data: articles } = await supabase
    .from("kb_articles")
    .select("id, title, kind")
    .eq("team_id", team.id)
    .order("title");

  return (
    <div className="p-6 sm:p-8">
      <Link href="/academy" className="text-sm text-slate-400 hover:text-brand">← Академия</Link>
      <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Новый курс</h1>
      <CourseEditor teamId={team.id} articles={(articles ?? []) as { id: string; title: string; kind: KbKind }[]} />
    </div>
  );
}
