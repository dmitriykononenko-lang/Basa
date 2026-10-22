import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import AssessReport, { type ReportBlock } from "@/components/assess/AssessReport";
import type { AssessBlock, AssessCompetency, ScoreRow, AssessmentRow } from "@/lib/assess";

export const dynamic = "force-dynamic";

export default async function AssessReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) notFound();
  const { team } = current;
  const supabase = await createClient();

  const { data: aRaw } = await supabase
    .from("assessments")
    .select("id, counterparty_id, respondent_name, method, status, created_at, completed_at")
    .eq("team_id", team.id)
    .eq("id", id)
    .maybeSingle();
  if (!aRaw) notFound();
  const assessment = aRaw as AssessmentRow;

  const [{ data: blocksRaw }, { data: compsRaw }, { data: scoresRaw }, cpRes] = await Promise.all([
    supabase.from("assess_blocks").select("id, key, name, sort, band").eq("team_id", team.id).order("sort", { ascending: true }),
    supabase.from("assess_competencies").select("id, block_id, name, definition, sort").eq("team_id", team.id).order("sort", { ascending: true }),
    supabase.from("assessment_scores").select("assessment_id, competency_id, score").eq("assessment_id", id),
    assessment.counterparty_id
      ? supabase.from("counterparties").select("name").eq("id", assessment.counterparty_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const blocks = (blocksRaw ?? []) as AssessBlock[];
  const competencies = (compsRaw ?? []) as AssessCompetency[];
  const scores = (scoresRaw ?? []) as ScoreRow[];
  const scoreByComp = new Map(scores.map((s) => [s.competency_id, Number(s.score)]));

  const subjectName =
    (cpRes.data as { name: string } | null)?.name ?? assessment.respondent_name ?? "Без имени";

  // Собираем блоки с параметрами и их баллами; балл блока = среднее по параметрам.
  const reportBlocks: ReportBlock[] = blocks
    .map((b) => {
      const comps = competencies
        .filter((c) => c.block_id === b.id)
        .map((c) => ({ name: c.name, score: scoreByComp.get(c.id) ?? 0, has: scoreByComp.has(c.id) }))
        .filter((c) => c.has)
        .map((c) => ({ name: c.name, score: c.score }));
      const blockScore = comps.length ? Math.round(comps.reduce((s, c) => s + c.score, 0) / comps.length) : 0;
      return { key: b.key, name: b.name, band: b.band, score: blockScore, items: comps };
    })
    .filter((b) => b.items.length > 0);

  if (reportBlocks.length === 0) {
    // Оценка не завершена — показываем заглушку.
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{subjectName}</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Эта оценка ещё не завершена — результатов пока нет.
        </p>
      </div>
    );
  }

  return (
    <AssessReport
      subjectName={subjectName}
      method={assessment.method}
      createdAt={assessment.completed_at ?? assessment.created_at}
      blocks={reportBlocks}
    />
  );
}
