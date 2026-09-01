// Модуль «Оценка персонала» — общие типы и шкала уровней.
// Балл параметра/блока: 0–100. Уровень — по шкале блока (band: пороги max L1..L4,
// дальше L5). У блоков разные пороги (band хранится в assess_blocks.band).

export type AssessBlock = {
  id: string;
  key: string;
  name: string;
  sort: number;
  band: number[]; // [maxL1, maxL2, maxL3, maxL4]
};

export type AssessCompetency = {
  id: string;
  block_id: string;
  name: string;
  definition: string | null;
  sort: number;
};

// reverse не отдаём в UI — реверс учитывается на сервере (assess_submit).
export type AssessItem = {
  id: string;
  competency_id: string;
  text: string;
  sort: number;
};

export type AssessmentRow = {
  id: string;
  counterparty_id: string | null;
  respondent_name: string | null;
  method: string;
  status: string; // 'in_progress' | 'done'
  created_at: string;
  completed_at: string | null;
  share_token?: string | null;
};

export type ScoreRow = { assessment_id: string; competency_id: string; score: number };

// Шкала Ликерта (1..5) — как показываем пункты.
export const LIKERT = [
  "Полностью не согласен",
  "Скорее не согласен",
  "Нейтрально",
  "Скорее согласен",
  "Полностью согласен",
];

export const LEVEL_NAMES = ["", "Низкий", "Ниже среднего", "Средний", "Выше среднего", "Высокий"];
// Красный → жёлтый → салатовый → зелёный → тёмно-зелёный.
export const LEVEL_COLORS = ["", "#ef5a3c", "#f2a33a", "#c8d64a", "#37c26b", "#159b57"];

// Универсальная шкала для сводных значений (Soft Skills в целом).
export const DEFAULT_BAND = [34, 50, 65, 85];

export function levelOf(score: number, band: number[] = DEFAULT_BAND): number {
  const b = band && band.length >= 4 ? band : DEFAULT_BAND;
  if (score <= b[0]) return 1;
  if (score <= b[1]) return 2;
  if (score <= b[2]) return 3;
  if (score <= b[3]) return 4;
  return 5;
}

export function levelColor(score: number, band: number[] = DEFAULT_BAND): string {
  return LEVEL_COLORS[levelOf(score, band)];
}

export function levelName(score: number, band: number[] = DEFAULT_BAND): string {
  return LEVEL_NAMES[levelOf(score, band)];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
