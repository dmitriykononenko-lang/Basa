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
