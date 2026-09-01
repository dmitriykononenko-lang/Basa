"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import type { KbQuestionType } from "@/lib/kb";

type QuizOption = { id: string; content: string };
type QuizQuestion = { id: string; prompt: string; qtype: KbQuestionType; position: number; options: QuizOption[] };
type Attempt = { score: number; passed: boolean; finished_at: string | null };

export default function QuizRunner({
  articleId,
  passScore,
  lastAttempt,
}: {
  articleId: string;
  passScore: number;
  lastAttempt: Attempt | null;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);

  async function start() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("kb_get_quiz", { _article_id: articleId });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const qs = (data ?? []) as QuizQuestion[];
    if (qs.length === 0) {
      toast.info("У этого материала нет проверочных вопросов");
      return;
    }
    setResult(null);
    setSelected({});
    setQuestions(qs);
  }

  function toggle(q: QuizQuestion, optionId: string) {
    setSelected((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.qtype === "multiple") {
        return { ...prev, [q.id]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
      }
      return { ...prev, [q.id]: [optionId] };
    });
  }

  async function submit() {
    if (!questions) return;
    const unanswered = questions.filter((q) => (selected[q.id] ?? []).length === 0);
    if (unanswered.length) {
      toast.error("Ответьте на все вопросы");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const answers = questions.map((q) => ({ question_id: q.id, selected_option_ids: selected[q.id] ?? [] }));
    const { data, error } = await supabase.rpc("kb_submit_quiz", {
      _article_id: articleId,
      _answers: answers,
      _course_id: null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const attempt = data as Attempt;
    setResult(attempt);
    setQuestions(null);
    toast[attempt.passed ? "success" : "error"](
      attempt.passed ? `Проверка пройдена: ${attempt.score}%` : `Не пройдено: ${attempt.score}%`,
    );
    router.refresh();
  }

  const shown = result ?? lastAttempt;

  return (
    <section className="surface mt-4 rounded-3xl p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Проверка знаний</h2>
        <span className="text-xs text-slate-400">Проходной балл: {passScore}%</span>
      </div>

      {shown && !questions && (
        <div
          className={`mb-3 rounded-2xl px-4 py-3 text-sm ${
            shown.passed
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
          }`}
        >
          Последний результат: {shown.score}% — {shown.passed ? "пройдено" : "не пройдено"}
        </div>
      )}

      {!questions ? (
        <button type="button" onClick={start} disabled={loading} className="btn-primary">
          {loading ? "Загрузка…" : shown ? "Пройти заново" : "Пройти проверку"}
        </button>
      ) : (
        <div className="space-y-5">
          {questions.map((q, qi) => (
            <div key={q.id}>
              <p className="mb-2 text-sm font-medium text-slate-900 dark:text-white">
                {qi + 1}. {q.prompt}
              </p>
              <div className="space-y-1.5">
                {q.options.map((o) => {
                  const on = (selected[q.id] ?? []).includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                        on
                          ? "border-brand bg-brand/5 text-slate-900 dark:text-white"
                          : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:text-neutral-300"
                      }`}
                    >
                      <input
                        type={q.qtype === "multiple" ? "checkbox" : "radio"}
                        name={`q-${q.id}`}
                        checked={on}
                        onChange={() => toggle(q, o.id)}
                        className="h-4 w-4 accent-brand"
                      />
                      {o.content}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={submitting} className="btn-primary">
              {submitting ? "Отправка…" : "Завершить проверку"}
            </button>
            <button type="button" onClick={() => setQuestions(null)} className="btn-ghost">
              Отмена
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
