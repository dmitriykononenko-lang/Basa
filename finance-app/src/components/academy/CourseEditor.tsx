"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import { KB_STATUS_LABELS, KB_KIND_LABELS, type KbStatus, type KbKind } from "@/lib/kb";

type ArticleOption = { id: string; title: string; kind: KbKind };

export type CourseEditorData = {
  id: string;
  title: string;
  status: KbStatus;
  description: string;
  cover_url: string | null;
  itemArticleIds: string[];
};

export default function CourseEditor({
  teamId,
  articles,
  initial,
}: {
  teamId: string;
  articles: ArticleOption[];
  initial?: CourseEditorData;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState<KbStatus>(initial?.status ?? "draft");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cover, setCover] = useState<string | null>(initial?.cover_url ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [itemIds, setItemIds] = useState<string[]>(initial?.itemArticleIds ?? []);
  const [toAdd, setToAdd] = useState("");
  const [saving, setSaving] = useState(false);

  const byId = new Map(articles.map((a) => [a.id, a]));

  async function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Нужен файл изображения");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${teamId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("kb-media").upload(path, file, {
      cacheControl: "31536000",
      upsert: false,
      contentType: file.type || undefined,
    });
    setUploading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCover(supabase.storage.from("kb-media").getPublicUrl(path).data.publicUrl);
  }
  const available = articles.filter((a) => !itemIds.includes(a.id));

  function move(i: number, dir: -1 | 1) {
    setItemIds((ids) => {
      const j = i + dir;
      if (j < 0 || j >= ids.length) return ids;
      const next = [...ids];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (!title.trim()) {
      toast.error("Укажите название курса");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      let id = initial?.id;
      if (id) {
        const { error } = await supabase
          .from("academy_courses")
          .update({ title, status, description, cover_url: cover })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("academy_courses")
          .insert({ team_id: teamId, title, status, description, cover_url: cover, created_by: auth.user?.id })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id as string;
      }

      // заменяем состав курса
      await supabase.from("academy_course_items").delete().eq("course_id", id);
      if (itemIds.length) {
        const { error } = await supabase.from("academy_course_items").insert(
          itemIds.map((articleId, idx) => ({ team_id: teamId, course_id: id, article_id: articleId, position: idx })),
        );
        if (error) throw error;
      }

      toast.success("Курс сохранён");
      router.push(`/academy/${id}/edit`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface space-y-4 rounded-3xl p-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Название курса</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Онбординг менеджера" className="input" />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статус</span>
            <Select
              value={status}
              onChange={(v) => setStatus(v as KbStatus)}
              options={(Object.keys(KB_STATUS_LABELS) as KbStatus[]).map((s) => ({ value: s, label: KB_STATUS_LABELS[s] }))}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Описание</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Кратко о курсе" className="input resize-y" />
        </label>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Обложка</span>
          <div className="flex items-center gap-4">
            <div className="h-20 w-32 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 dark:bg-neutral-800 dark:ring-white/10">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl text-slate-300">🎓</div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-ghost text-sm disabled:opacity-50">
                {uploading ? "Загрузка…" : cover ? "Заменить" : "Загрузить обложку"}
              </button>
              {cover && (
                <button type="button" onClick={() => setCover(null)} className="text-xs text-slate-400 hover:text-red-500">Убрать</button>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickCover} className="hidden" />
            </div>
          </div>
        </div>
      </section>

      <section className="surface space-y-3 rounded-3xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Материалы курса</h2>
        {itemIds.length > 0 ? (
          <ol className="space-y-2">
            {itemIds.map((aid, i) => {
              const a = byId.get(aid);
              return (
                <li key={aid} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="w-5 text-xs text-slate-400">{i + 1}.</span>
                  <span className="flex-1 text-sm text-slate-800 dark:text-neutral-200">
                    {a ? a.title : "(материал недоступен)"}
                    {a && <span className="ml-2 text-xs text-slate-400">{KB_KIND_LABELS[a.kind]}</span>}
                  </span>
                  <button type="button" onClick={() => move(i, -1)} className="btn-ghost px-2 text-sm" title="Вверх">↑</button>
                  <button type="button" onClick={() => move(i, 1)} className="btn-ghost px-2 text-sm" title="Вниз">↓</button>
                  <button type="button" onClick={() => setItemIds((ids) => ids.filter((x) => x !== aid))} className="btn-ghost px-2 text-sm">×</button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-slate-400">Добавьте материалы из базы знаний.</p>
        )}
        {available.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                value={toAdd}
                onChange={setToAdd}
                placeholder="— выберите материал —"
                options={available.map((a) => ({ value: a.id, label: `${a.title} · ${KB_KIND_LABELS[a.kind]}` }))}
              />
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                if (!toAdd) return;
                setItemIds((ids) => [...ids, toAdd]);
                setToAdd("");
              }}
            >
              Добавить
            </button>
          </div>
        )}
      </section>

      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={save} className="btn-primary">
          {saving ? "Сохранение…" : "Сохранить курс"}
        </button>
        <button type="button" onClick={() => router.push("/academy")} className="btn-ghost">К списку</button>
      </div>
    </div>
  );
}
