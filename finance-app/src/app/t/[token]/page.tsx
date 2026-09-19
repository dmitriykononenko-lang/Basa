import { createClient } from "@/lib/supabase/server";
import AssessTake from "@/components/assess/AssessTake";
import type { AssessBlock, AssessCompetency, AssessItem } from "@/lib/assess";

export const dynamic = "force-dynamic";

// Публичная страница прохождения оценки по ссылке-токену (без входа в Basa).
type LoadResult = {
  status: string;
  subject_name: string | null;
  team_name: string | null;
  blocks: AssessBlock[];
  competencies: AssessCompetency[];
  items: AssessItem[];
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-950">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5 py-16 text-center">
        {children}
      </div>
    </div>
  );
}

export default async function PublicAssessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assess_public_load", { p_token: token });

  if (error || !data) {
    return (
      <Shell>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Ссылка недействительна</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
          Проверьте ссылку или запросите новую у того, кто прислал тест.
        </p>
      </Shell>
    );
  }

  const res = data as LoadResult;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-950">
      <AssessTake
        token={token}
        subjectName={res.subject_name ?? "Сотрудник"}
        teamName={res.team_name ?? ""}
        initialStatus={res.status}
        blocks={res.blocks ?? []}
        competencies={res.competencies ?? []}
        items={res.items ?? []}
      />
    </div>
  );
}
