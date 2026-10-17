import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx } from "@/lib/team";
import ArticleEditor from "@/components/kb/ArticleEditor";
import type { KbDepartment } from "@/lib/kb";

export default async function NewArticlePage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/knowledge-base");
  const { team, role } = current;
  if (!canWriteTx(role)) redirect("/knowledge-base");

  const supabase = await createClient();
  const { data: depts } = await supabase
    .from("kb_departments")
    .select("id, team_id, name, parent_id")
    .eq("team_id", team.id)
    .order("name");

  return (
    <div className="p-6 sm:p-8">
      <Link href="/knowledge-base" className="text-sm text-slate-400 hover:text-brand">
        ← База знаний
      </Link>
      <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Новый материал
      </h1>
      <ArticleEditor teamId={team.id} departments={(depts ?? []) as KbDepartment[]} />
    </div>
  );
}
