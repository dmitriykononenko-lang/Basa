"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import {
  KB_KIND_LABELS,
  KB_STATUS_LABELS,
  KB_QTYPE_LABELS,
  type KbKind,
  type KbStatus,
  type KbQuestionType,
  type KbDepartment,
} from "@/lib/kb";

type OptionDraft = { content: string; is_correct: boolean };
type QuestionDraft = { prompt: string; qtype: KbQuestionType; options: OptionDraft[] };

export type ArticleEditorData = {
  id: string;
  kind: KbKind;
  status: KbStatus;
  title: string;
  body: string;
  pass_score: number;
  checklist: { content: string }[];
  questions: QuestionDraft[];
  departmentIds: string[];
  positions: string[];
};

export default function ArticleEditor({
  teamId,
  departments,
  initial,
}: {
  teamId: string;
  departments: KbDepartment[];
  initial?: ArticleEditorData;
}) {
  const router = useRouter();

  const [kind, setKind] = useState<KbKind>(initial?.kind ?? "regulation");
  const [status, setStatus] = useState<KbStatus>(initial?.status ?? "draft");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [passScore, setPassScore] = useState(initial?.pass_score ?? 80);
  const [checklist, setChecklist] = useState<{ content: string }[]>(initial?.checklist ?? []);
  const [questions, setQuestions] = useState<QuestionDraft[]>(initial?.questions ?? []);
  const [deptIds, setDeptIds] = useState<string[]>(initial?.departmentIds ?? []);
  const [positions, setPositions] = useState((initial?.positions ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  // ---- конструктор вопросов ----
  function addQuestion() {
    setQuestions((qs) => [
      ...qs,
      { prompt: "", qtype: "single", options: [{ content: "", is_correct: true }, { content: "", is_correct: false }] },
    ]);
  }
  function patchQuestion(i: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function removeQuestion(i: number) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }
  function addOption(qi: number) {
    setQuestions((qs) =>
      qs.map((q, idx) => (idx === qi ? { ...q, options: [...q.options, { content: "", is_correct: false }] } : q)),
    );
  }
  function patchOption(qi: number, oi: number, patch: Partial<OptionDraft>) {
    setQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== qi) return q;
        let options = q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o));
        // у single/boolean правильный ответ только один
        if (patch.is_correct && q.qtype !== "multiple") {
          options = options.map((o, j) => ({ ...o, is_correct: j === oi }));
        }
        return { ...q, options };
      }),
    );
  }
  function removeOption(qi: number, oi: number) {
    setQuestions((qs) =>
      qs.map((q, idx) => (idx === qi ? { ...q, options: q.options.filter((_, j) => j !== oi) } : q)),
    );
  }

  function validate(): string | null {
    if (!title.trim()) return "Укажите название";
    for (const q of questions) {
      if (!q.prompt.trim()) return "У каждого вопроса должен быть текст";
      const filled = q.options.filter((o) => o.content.trim());
      if (filled.length < 2) return "У вопроса должно быть минимум 2 варианта ответа";
      if (!filled.some((o) => o.is_correct)) return "Отметьте хотя бы один правильный вариант";
    }
    return null;
  }

  async function save() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const supabase = createClient();

    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;

      // 1) статья
      let articleId = initial?.id;
      if (articleId) {
        const { error } = await supabase
          .from("kb_articles")
          .update({ kind, status, title, body, pass_score: passScore })
          .eq("id", articleId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("kb_articles")
          .insert({ team_id: teamId, kind, status, title, body, pass_score: passScore, created_by: uid })
          .select("id")
          .single();
        if (error) throw error;
        articleId = data.id as string;
      }

      // 2) заменяем дочерние сущности (просто и предсказуемо для редактора)
      await supabase.from("kb_questions").delete().eq("article_id", articleId);
      await supabase.from("kb_checklist_items").delete().eq("article_id", articleId);
      await supabase.from("kb_article_targets").delete().eq("article_id", articleId);

      // чек-лист
      const items = checklist.filter((c) => c.content.trim());
      if (items.length) {
        const { error } = await supabase.from("kb_checklist_items").insert(
          items.map((c, idx) => ({ team_id: teamId, article_id: articleId, content: c.content, position: idx })),
        );
        if (error) throw error;
      }

      // целевая аудитория
      const targetRows = [
        ...deptIds.map((id) => ({ team_id: teamId, article_id: articleId, department_id: id, position: null as string | null })),
        ...positions
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => ({ team_id: teamId, article_id: articleId, department_id: null as string | null, position: p })),
      ];
      if (targetRows.length) {
        const { error } = await supabase.from("kb_article_targets").insert(targetRows);
        if (error) throw error;
      }

      // вопросы + варианты
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        const { data: qRow, error: qErr } = await supabase
          .from("kb_questions")
          .insert({ team_id: teamId, article_id: articleId, prompt: q.prompt, qtype: q.qtype, position: qi })
          .select("id")
          .single();
        if (qErr) throw qErr;
        const opts = q.options.filter((o) => o.content.trim());
        const { error: oErr } = await supabase.from("kb_answer_options").insert(
          opts.map((o, oi) => ({
            team_id: teamId,
            question_id: qRow.id,
            content: o.content,
            is_correct: o.is_correct,
            position: oi,
          })),
        );
        if (oErr) throw oErr;
      }

      toast.success("Сохранено");
      router.push(`/knowledge-base/${articleId}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface space-y-4 rounded-3xl p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Тип">
            <Select
              value={kind}
              onChange={(v) => setKind(v as KbKind)}
              options={(Object.keys(KB_KIND_LABELS) as KbKind[]).map((k) => ({ value: k, label: KB_KIND_LABELS[k] }))}
            />
          </Field>
          <Field label="Статус">
            <Select
              value={status}
              onChange={(v) => setStatus(v as KbStatus)}
              options={(Object.keys(KB_STATUS_LABELS) as KbStatus[]).map((s) => ({ value: s, label: KB_STATUS_LABELS[s] }))}
            />
          </Field>
          <Field label="Проходной балл, %">
            <input
              type="number"
              min={0}
              max={100}
              value={passScore}
              onChange={(e) => setPassScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="input"
            />
          </Field>
        </div>
        <Field label="Название">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Регламент работы с клиентом" className="input" />
        </Field>
        <Field label="Содержание">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="Текст регламента / статьи…" className="input resize-y" />
        </Field>
      </section>

      {/* Целевая аудитория */}
      <section className="surface space-y-3 rounded-3xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Кому адресовано</h2>
        {departments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => {
              const on = deptIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDeptIds((ids) => (on ? ids.filter((x) => x !== d.id) : [...ids, d.id]))}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    on ? "bg-brand text-white" : "bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Отделы не созданы — добавьте их в разделе «Отделы».</p>
        )}
        <Field label="Должности (через запятую, необязательно)">
          <input value={positions} onChange={(e) => setPositions(e.target.value)} placeholder="Менеджер, Бухгалтер" className="input" />
        </Field>
      </section>

      {/* Чек-лист */}
      {kind === "checklist" && (
        <section className="surface space-y-3 rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Пункты чек-листа</h2>
            <button type="button" onClick={() => setChecklist((c) => [...c, { content: "" }])} className="btn-ghost text-sm">
              + Пункт
            </button>
          </div>
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={c.content}
                onChange={(e) => setChecklist((arr) => arr.map((x, idx) => (idx === i ? { content: e.target.value } : x)))}
                placeholder={`Пункт ${i + 1}`}
                className="input flex-1"
              />
              <button type="button" onClick={() => setChecklist((arr) => arr.filter((_, idx) => idx !== i))} className="btn-ghost text-sm">
                Удалить
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Проверочные вопросы */}
      <section className="surface space-y-4 rounded-3xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Проверочные вопросы</h2>
          <button type="button" onClick={addQuestion} className="btn-ghost text-sm">+ Вопрос</button>
        </div>
        {questions.length === 0 && <p className="text-xs text-slate-400">Вопросов нет — проверка не будет показана.</p>}
        {questions.map((q, qi) => (
          <div key={qi} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <Field label={`Вопрос ${qi + 1}`}>
                  <input value={q.prompt} onChange={(e) => patchQuestion(qi, { prompt: e.target.value })} placeholder="Текст вопроса" className="input" />
                </Field>
              </div>
              <div className="w-48">
                <Field label="Тип">
                  <Select
                    value={q.qtype}
                    onChange={(v) => patchQuestion(qi, { qtype: v as KbQuestionType })}
                    options={(Object.keys(KB_QTYPE_LABELS) as KbQuestionType[]).map((t) => ({ value: t, label: KB_QTYPE_LABELS[t] }))}
                  />
                </Field>
              </div>
              <button type="button" onClick={() => removeQuestion(qi)} className="btn-ghost text-sm">Удалить вопрос</button>
            </div>
            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type={q.qtype === "multiple" ? "checkbox" : "radio"}
                    name={`correct-${qi}`}
                    checked={o.is_correct}
                    onChange={(e) => patchOption(qi, oi, { is_correct: e.target.checked })}
                    className="h-4 w-4 accent-brand"
                    title="Правильный ответ"
                  />
                  <input
                    value={o.content}
                    onChange={(e) => patchOption(qi, oi, { content: e.target.value })}
                    placeholder={`Вариант ${oi + 1}`}
                    className="input flex-1"
                  />
                  <button type="button" onClick={() => removeOption(qi, oi)} className="btn-ghost text-sm">×</button>
                </div>
              ))}
              <button type="button" onClick={() => addOption(qi)} className="text-sm text-brand hover:underline">+ Вариант</button>
            </div>
          </div>
        ))}
      </section>

      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={save} className="btn-primary">
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">Отмена</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
