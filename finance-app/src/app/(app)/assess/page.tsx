import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import AssessView from "@/components/assess/AssessView";
import type {
  AssessBlock,
  AssessCompetency,
  AssessItem,
  AssessmentRow,
  ScoreRow,
} from "@/lib/assess";

export const dynamic = "force-dynamic";

export type EmployeeOption = { id: string; name: string };

export default async function AssessPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Оценка персонала
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }
  const { team } = current;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;

  const [
    { data: blocksRaw },
    { data: compsRaw },
    { data: itemsRaw },
    { data: cpsRaw },
    { data: assessRaw },
    { data: scoresRaw },
  ] = await Promise.all([
    supabase.from("assess_blocks").select("id, key, name, sort, band").eq("team_id", team.id).order("sort", { ascending: true }),
    supabase.from("assess_competencies").select("id, block_id, name, definition, sort").eq("team_id", team.id).order("sort", { ascending: true }),
    supabase.from("assess_items").select("id, competency_id, text, sort").eq("team_id", team.id).order("sort", { ascending: true }),
    supabase.from("counterparties").select("id, name, kind, kinds").eq("team_id", team.id).eq("archived", false).order("name", { ascending: true }),
    supabase.from("assessments").select("id, counterparty_id, respondent_name, method, status, created_at, completed_at").eq("team_id", team.id).order("created_at", { ascending: false }),
    supabase.from("assessment_scores").select("assessment_id, competency_id, score").eq("team_id", team.id),
  ]);

  const blocks = (blocksRaw ?? []) as AssessBlock[];
  const competencies = (compsRaw ?? []) as AssessCompetency[];
  const items = (itemsRaw ?? []) as AssessItem[];
  const assessments = (assessRaw ?? []) as AssessmentRow[];
  const scores = (scoresRaw ?? []) as ScoreRow[];

  // Сотрудники = контрагенты с kind='employee' (или в массиве kinds).
  const employees: EmployeeOption[] = ((cpsRaw ?? []) as { id: string; name: string; kind: string | null; kinds: string[] | null }[])
    .filter((c) => c.kind === "employee" || (c.kinds ?? []).includes("employee"))
    .map((c) => ({ id: c.id, name: c.name }));

  // Средний балл по каждой завершённой оценке (для карточки в списке).
  const sumById = new Map<string, { sum: number; n: number }>();
  for (const s of scores) {
    const acc = sumById.get(s.assessment_id) ?? { sum: 0, n: 0 };
    acc.sum += Number(s.score);
    acc.n += 1;
    sumById.set(s.assessment_id, acc);
  }
  const overallById: Record<string, number | null> = {};
  for (const a of assessments) {
    const acc = sumById.get(a.id);
    overallById[a.id] = acc && acc.n > 0 ? Math.round(acc.sum / acc.n) : null;
  }

  const cpName = new Map(employees.map((e) => [e.id, e.name]));

  return (
    <AssessView
      teamId={team.id}
      uid={uid}
      blocks={blocks}
      competencies={competencies}
      items={items}
      employees={employees}
      assessments={assessments.map((a) => ({
        ...a,
        subjectName: a.counterparty_id ? cpName.get(a.counterparty_id) ?? a.respondent_name : a.respondent_name,
        overall: overallById[a.id] ?? null,
      }))}
    />
  );
}
