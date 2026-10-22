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

export type EmployeeOption = { id: string; name: string; email: string | null };

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
    supabase.from("counterparties").select("id, name, kind, kinds, email").eq("team_id", team.id).eq("archived", false).order("name", { ascending: true }),
    supabase.from("assessments").select("id, counterparty_id, respondent_name, method, status, created_at, completed_at, share_token").eq("team_id", team.id).order("created_at", { ascending: false }),
    supabase.from("assessment_scores").select("assessment_id, competency_id, score").eq("team_id", team.id),
  ]);

  const blocks = (blocksRaw ?? []) as AssessBlock[];
  const competencies = (compsRaw ?? []) as AssessCompetency[];
  const items = (itemsRaw ?? []) as AssessItem[];
  const assessments = (assessRaw ?? []) as AssessmentRow[];
  const scores = (scoresRaw ?? []) as ScoreRow[];

  // Сотрудники = контрагенты с kind='employee' (или в массиве kinds).
  const employees: EmployeeOption[] = ((cpsRaw ?? []) as { id: string; name: string; kind: string | null; kinds: string[] | null; email: string | null }[])
    .filter((c) => c.kind === "employee" || (c.kinds ?? []).includes("employee"))
    .map((c) => ({ id: c.id, name: c.name, email: c.email }));

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

  // Профиль компании: средний балл по каждой компетенции по всем завершённым оценкам.
  const compAgg = new Map<string, { sum: number; n: number }>();
  const doneAssessments = new Set<string>();
  for (const s of scores) {
    doneAssessments.add(s.assessment_id);
    const acc = compAgg.get(s.competency_id) ?? { sum: 0, n: 0 };
    acc.sum += Number(s.score); acc.n += 1; compAgg.set(s.competency_id, acc);
  }
  const blockName = new Map(blocks.map((b) => [b.id, b.name]));
  const compCompany = competencies
    .filter((c) => compAgg.has(c.id))
    .map((c) => ({ name: c.name, block_id: c.block_id, block: blockName.get(c.block_id) ?? "", score: Math.round(compAgg.get(c.id)!.sum / compAgg.get(c.id)!.n) }));

  let company = null as null | {
    participants: number; overall: number;
    blocks: { key: string; name: string; band: number[]; score: number }[];
    strengths: { name: string; score: number; block: string }[];
    gaps: { name: string; score: number; block: string }[];
  };
  if (compCompany.length > 0 && doneAssessments.size > 0) {
    const companyBlocks = blocks
      .map((b) => {
        const inBlock = compCompany.filter((c) => c.block_id === b.id);
        const score = inBlock.length ? Math.round(inBlock.reduce((s, c) => s + c.score, 0) / inBlock.length) : 0;
        return { key: b.key, name: b.name, band: b.band, score, has: inBlock.length > 0 };
      })
      .filter((b) => b.has)
      .map(({ key, name, band, score }) => ({ key, name, band, score }));
    const overall = Math.round(compCompany.reduce((s, c) => s + c.score, 0) / compCompany.length);
    const sorted = [...compCompany].sort((a, b) => b.score - a.score);
    company = {
      participants: doneAssessments.size,
      overall,
      blocks: companyBlocks,
      strengths: sorted.slice(0, 5).map((c) => ({ name: c.name, score: c.score, block: c.block })),
      gaps: sorted.slice(-5).reverse().map((c) => ({ name: c.name, score: c.score, block: c.block })),
    };
  }

  return (
    <AssessView
      teamId={team.id}
      uid={uid}
      company={company}
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
