"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Combobox, { type ComboOption } from "@/components/Combobox";
import LikertTest from "@/components/assess/LikertTest";
import {
  levelColor,
  levelName,
  initials,
  DEFAULT_BAND,
  type AssessBlock,
  type AssessCompetency,
  type AssessItem,
} from "@/lib/assess";

type EmployeeOption = { id: string; name: string };
type AssessmentCard = {
  id: string;
  counterparty_id: string | null;
  respondent_name: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  share_token?: string | null;
  subjectName: string | null | undefined;
  overall: number | null;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function takeUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/t/${token}`;
}

export default function AssessView({
  teamId,
  uid,
  blocks,
  competencies,
  items,
  employees,
  assessments,
}: {
  teamId: string;
  uid: string | null;
  blocks: AssessBlock[];
  competencies: AssessCompetency[];
  items: AssessItem[];
  employees: EmployeeOption[];
  assessments: AssessmentCard[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<"list" | "test">("list");
  const [subjectId, setSubjectId] = useState("");
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [starting, setStarting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<{ name: string; url: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const empOptions: ComboOption[] = employees.map((e) => ({ value: e.id, label: e.name }));
  const subjectName = employees.find((e) => e.id === subjectId)?.name ?? "";

  const totalItems = items.length;
  const answeredCount = Object.keys(answers).length;
  const progress = totalItems ? Math.round((answeredCount / totalItems) * 100) : 0;

  function setAnswer(itemId: string, v: number) {
    setAnswers((a) => ({ ...a, [itemId]: v }));
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  // Создать оценку в БД (in_progress) и вернуть {id, token}.
  async function createAssessment(): Promise<{ id: string; token: string } | null> {
    const { data, error } = await supabase
      .from("assessments")
      .insert({
        team_id: teamId,
        counterparty_id: subjectId,
        respondent_name: subjectName,
        method: "self",
        status: "in_progress",
        created_by: uid,
      })
      .select("id, share_token")
      .single();
    if (error || !data) {
      setError(error?.message ?? "Не удалось создать оценку");
      return null;
    }
    return { id: data.id, token: data.share_token as string };
  }

  async function startTest() {
    if (!subjectId) return;
    setStarting(true);
    setError(null);
    setShared(null);
    const res = await createAssessment();
    setStarting(false);
    if (!res) return;
    setAssessmentId(res.id);
    setAnswers({});
    setMode("test");
    window.scrollTo({ top: 0 });
  }

  async function createLink() {
    if (!subjectId) return;
    setSharing(true);
    setError(null);
    const res = await createAssessment();
    setSharing(false);
    if (!res) return;
    const url = takeUrl(res.token);
    await copy(url);
    setShared({ name: subjectName, url });
    setSubjectId("");
    router.refresh();
  }

  async function submit() {
    if (!assessmentId) return;
    if (answeredCount < totalItems) {
      setError(`Ответьте на все пункты (${answeredCount} из ${totalItems}).`);
      const firstUnanswered = items.find((it) => answers[it.id] === undefined);
      if (firstUnanswered) document.getElementById(`item-${firstUnanswered.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("assess_submit", { p_assessment: assessmentId, p_answers: answers });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/assess/${assessmentId}`);
  }

  function cancel() {
    setMode("list");
    setAssessmentId(null);
    setAnswers({});
    setSubjectId("");
    setError(null);
  }

  async function copyCard(a: AssessmentCard) {
    if (!a.share_token) return;
    const ok = await copy(takeUrl(a.share_token));
    if (ok) {
      setCopiedId(a.id);
      setTimeout(() => setCopiedId((c) => (c === a.id ? null : c)), 2000);
    }
  }

  // ------- Список оценок -------
  if (mode === "list") {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Оценка персонала</h1>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-neutral-400">
              Тест Soft Skills · {totalItems} пунктов · {blocks.length} блоков
            </p>
          </div>
        </div>

        {/* Запуск новой оценки */}
        <div className="surface mt-6 p-5 sm:p-6">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Новая оценка</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
            Выберите сотрудника, затем отправьте ему ссылку на тест или пройдите опросник сами.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Combobox
              value={subjectId}
              onChange={setSubjectId}
              options={empOptions}
              placeholder="— выберите сотрудника —"
              className="sm:max-w-sm sm:flex-1"
            />
            <div className="flex gap-2">
              <button type="button" className="btn-primary shrink-0" disabled={!subjectId || sharing || starting} onClick={createLink}>
                {sharing ? "Создаём…" : "Ссылка для сотрудника"}
              </button>
              <button type="button" className="btn-ghost shrink-0" disabled={!subjectId || starting || sharing} onClick={startTest}>
                {starting ? "…" : "Пройти самому"}
              </button>
            </div>
          </div>
          {employees.length === 0 && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              Нет сотрудников. Добавьте их в разделе «Сотрудники».
            </p>
          )}
          {error && <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

          {shared && (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                Ссылка для «{shared.name}» скопирована
              </div>
              <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/70">
                Отправьте её сотруднику — он пройдёт тест без входа в Basa, отчёт появится здесь автоматически.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={shared.url} onFocus={(e) => e.currentTarget.select()} className="input font-mono text-xs" />
                <button type="button" className="btn-ghost shrink-0" onClick={() => copy(shared.url)}>
                  Копировать
                </button>
              </div>
            </div>
          )}
        </div>

        {/* История оценок */}
        <h2 className="mt-8 text-sm font-bold text-slate-900 dark:text-white">Проведённые оценки</h2>
        {assessments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Пока нет ни одной оценки.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assessments.map((a) => {
              const name = a.subjectName ?? "Без имени";
              const done = a.status === "done";
              const col = a.overall != null ? levelColor(a.overall, DEFAULT_BAND) : "#8b8f84";
              const inner = (
                <div className="surface flex h-full items-center gap-4 p-4 transition hover:ring-brand/40">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white"
                    style={{ background: "linear-gradient(135deg,#3b7bff,#6d5dfb)" }}
                  >
                    {initials(name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={name}>
                      {name}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">{fmtDate(a.created_at)}</div>
                  </div>
                  {done && a.overall != null ? (
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-2xl font-semibold leading-none" style={{ color: col }}>
                        {a.overall}
                      </div>
                      <div className="mt-0.5 text-[11px] font-medium" style={{ color: col }}>
                        {levelName(a.overall, DEFAULT_BAND)}
                      </div>
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      Ожидает
                    </span>
                  )}
                </div>
              );
              return done ? (
                <Link key={a.id} href={`/assess/${a.id}`} className="block">
                  {inner}
                </Link>
              ) : (
                <div key={a.id} className="flex flex-col gap-1">
                  {inner}
                  {a.share_token && (
                    <button
                      type="button"
                      onClick={() => copyCard(a)}
                      className="self-start px-1 text-xs font-medium text-brand hover:underline"
                    >
                      {copiedId === a.id ? "Ссылка скопирована ✓" : "Копировать ссылку на тест"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ------- Прохождение теста (внутри приложения) -------
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-slate-100 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-white/[0.07] dark:bg-neutral-950/70 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400 dark:text-neutral-500">Оценка · самооценка</div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">{subjectName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-500 dark:text-neutral-400">
              {answeredCount} / {totalItems}
            </span>
            <button type="button" className="btn-ghost" onClick={cancel}>
              Отмена
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
              {saving ? "Считаем…" : "Завершить"}
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <p className="mb-5 text-sm text-slate-500 dark:text-neutral-400">
        Оцените, насколько каждое утверждение верно. Отвечайте честно — правильных и неправильных ответов нет.
      </p>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </p>
      )}

      <LikertTest blocks={blocks} competencies={competencies} items={items} answers={answers} onAnswer={setAnswer} />

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn-ghost" onClick={cancel}>
          Отмена
        </button>
        <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
          {saving ? "Считаем…" : "Завершить оценку"}
        </button>
      </div>
    </div>
  );
}
