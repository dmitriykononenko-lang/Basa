"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LikertTest from "@/components/assess/LikertTest";
import type { AssessBlock, AssessCompetency, AssessItem } from "@/lib/assess";

// Публичное прохождение оценки по ссылке-токену (без входа в Basa).
export default function AssessTake({
  token,
  subjectName,
  teamName,
  initialStatus,
  blocks,
  competencies,
  items,
}: {
  token: string;
  subjectName: string;
  teamName: string;
  initialStatus: string;
  blocks: AssessBlock[];
  competencies: AssessCompetency[];
  items: AssessItem[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(initialStatus === "done");

  const totalItems = items.length;
  const answeredCount = Object.keys(answers).length;
  const progress = totalItems ? Math.round((answeredCount / totalItems) * 100) : 0;

  function setAnswer(itemId: string, v: number) {
    setAnswers((a) => ({ ...a, [itemId]: v }));
  }

  async function submit() {
    if (answeredCount < totalItems) {
      setError(`Ответьте на все пункты (${answeredCount} из ${totalItems}).`);
      const first = items.find((it) => answers[it.id] === undefined);
      if (first) document.getElementById(`item-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("assess_public_submit", { p_token: token, p_answers: answers });
    setSaving(false);
    if (error) {
      setError(error.message.includes("already completed") ? "Этот тест уже пройден." : error.message);
      return;
    }
    setDone(true);
    window.scrollTo({ top: 0 });
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl text-3xl text-white" style={{ background: "linear-gradient(135deg,#29bf12,#159b57)" }}>
          ✓
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Спасибо!</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
          Ответы сохранены. Результаты доступны в системе оценки команды {teamName}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {/* Липкая шапка с прогрессом */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur dark:border-white/[0.07] dark:bg-neutral-950/80 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-neutral-500">
              Оценка Soft Skills · {teamName}
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">{subjectName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-500 dark:text-neutral-400">{answeredCount} / {totalItems}</span>
            <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
              {saving ? "Отправляем…" : "Завершить"}
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <p className="mb-5 text-sm text-slate-500 dark:text-neutral-400">
        Оцените, насколько каждое утверждение верно для вас. Отвечайте честно — правильных и неправильных ответов нет.
      </p>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>
      )}

      <LikertTest blocks={blocks} competencies={competencies} items={items} answers={answers} onAnswer={setAnswer} />

      <div className="mt-6 flex justify-end">
        <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
          {saving ? "Отправляем…" : "Завершить тест"}
        </button>
      </div>
    </div>
  );
}
