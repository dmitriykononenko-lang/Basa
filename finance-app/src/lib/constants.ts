export const CURRENCIES = ["RUB", "USD", "EUR", "KZT", "UAH", "GBP", "CNY"];

export const ACCOUNT_KINDS: { value: string; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "bank", label: "Банк" },
  { value: "card", label: "Карта" },
  { value: "other", label: "Другое" },
];

export const ACCOUNT_KIND_LABELS: Record<string, string> = Object.fromEntries(
  ACCOUNT_KINDS.map((k) => [k.value, k.label])
);
