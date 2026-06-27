// Типы и подписи для модуля «Академия».
import type { KbStatus } from "./kb";

export type AcademyAssigneeType = "department" | "user";
export type AcademyProgressStatus = "not_started" | "in_progress" | "done";

export type AcademyCourse = {
  id: string;
  team_id: string;
  status: KbStatus;
  title: string;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyCourseItem = {
  id: string;
  course_id: string;
  article_id: string;
  position: number;
};

export const ACADEMY_PROGRESS_LABELS: Record<AcademyProgressStatus, string> = {
  not_started: "Не начато",
  in_progress: "В процессе",
  done: "Пройдено",
};

// Доля пройденных элементов курса (0..100).
export function courseProgressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((100 * done) / total);
}

// ---- Оргструктура и таргетинг обучения ----
// Назначение курса «на отдел» = узел оргструктуры (kb_departments) вместе со всем
// поддеревом. Сотрудник «относится» к узлу-назначению, если этот узел — его узел
// (counterparties.unit_id) или любой из его предков. Возвращает множество таких
// узлов (сам узел + все предки) по карте parent_id.
export function unitAncestors(unitId: string | null | undefined, parentOf: Map<string, string | null>): Set<string> {
  const out = new Set<string>();
  let cur = unitId ?? null;
  while (cur && !out.has(cur)) {
    out.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

// ---- Дедлайны ----
export type DueStatus = "overdue" | "soon" | "ok";

export const DUE_LABELS: Record<DueStatus, string> = {
  overdue: "Просрочено",
  soon: "Скоро срок",
  ok: "В срок",
};

// Статус по сроку. allDone=true → null (срок неактуален). today — 'YYYY-MM-DD'.
export function dueStatus(due: string | null, allDone: boolean, today: string): DueStatus | null {
  if (!due || allDone) return null;
  if (due < today) return "overdue";
  const day = new Date(due + "T00:00:00").getTime();
  const now = new Date(today + "T00:00:00").getTime();
  return day - now <= 7 * 86400000 ? "soon" : "ok";
}

export function dueBadgeClass(s: DueStatus): string {
  switch (s) {
    case "overdue":
      return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400";
    case "soon":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    default:
      return "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400";
  }
}
