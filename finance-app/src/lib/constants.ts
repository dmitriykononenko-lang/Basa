export const CURRENCIES = ["RUB", "USD", "USDT", "EUR", "KZT", "UAH", "GBP", "CNY"];

export const EMPLOYMENT_TYPES: { value: string; label: string }[] = [
  { value: "salary", label: "Окладная" },
  { value: "project", label: "Проектная" },
  { value: "mixed", label: "Смешанная" },
];
export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  EMPLOYMENT_TYPES.map((e) => [e.value, e.label])
);

export const ACCOUNT_KINDS: { value: string; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "bank", label: "Банк" },
  { value: "card", label: "Карта" },
  { value: "other", label: "Другое" },
];

export const ACCOUNT_KIND_LABELS: Record<string, string> = Object.fromEntries(
  ACCOUNT_KINDS.map((k) => [k.value, k.label])
);

export const COUNTERPARTY_KINDS: { value: string; label: string }[] = [
  { value: "client", label: "Клиент" },
  { value: "supplier", label: "Поставщик" },
  { value: "partner", label: "Партнёр" },
  { value: "other", label: "Другое" },
];

export const COUNTERPARTY_KIND_LABELS: Record<string, string> =
  Object.fromEntries(COUNTERPARTY_KINDS.map((k) => [k.value, k.label]));

// Вид деятельности для ДДС
export const CF_ACTIVITIES: { value: string; label: string; hint: string }[] = [
  { value: "operating", label: "Операционная", hint: "Основная ежедневная работа бизнеса" },
  { value: "investing", label: "Инвестиционная", hint: "Основные средства и капитальные вложения" },
  { value: "financial", label: "Финансовая", hint: "Кредиты, займы, ввод/вывод денег, дивиденды" },
];
export const CF_ACTIVITY_LABELS: Record<string, string> = Object.fromEntries(
  CF_ACTIVITIES.map((a) => [a.value, a.label])
);

// Правило учёта в ОПиУ
export const PNL_TREATMENTS: { value: string; label: string }[] = [
  { value: "auto", label: "Определять автоматически" },
  { value: "direct", label: "Прямой расход" },
  { value: "indirect", label: "Косвенный расход" },
  { value: "other", label: "Прочий" },
  { value: "excluded", label: "Исключить из ОПиУ" },
];
export const PNL_TREATMENT_LABELS: Record<string, string> = Object.fromEntries(
  PNL_TREATMENTS.map((p) => [p.value, p.label])
);
