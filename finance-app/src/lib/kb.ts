// Типы и подписи для модуля «База знаний».
export type KbKind = "regulation" | "article" | "checklist";
export type KbStatus = "draft" | "published" | "archived";
export type KbQuestionType = "single" | "multiple" | "boolean";

export const KB_KIND_LABELS: Record<KbKind, string> = {
  regulation: "Регламент",
  article: "Статья",
  checklist: "Чек-лист",
};

export const KB_STATUS_LABELS: Record<KbStatus, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  archived: "В архиве",
};

export const KB_QTYPE_LABELS: Record<KbQuestionType, string> = {
  single: "Один правильный",
  multiple: "Несколько правильных",
  boolean: "Да / Нет",
};

export type KbArticle = {
  id: string;
  team_id: string;
  kind: KbKind;
  status: KbStatus;
  title: string;
  body: string;
  pass_score: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type KbDepartment = {
  id: string;
  team_id: string;
  name: string;
  parent_id: string | null;
};

// Цвет бейджа статуса.
export function kbStatusBadgeClass(status: KbStatus): string {
  switch (status) {
    case "published":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "archived":
      return "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400";
    default:
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  }
}
