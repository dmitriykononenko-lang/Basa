// Суммы хранятся в минорных единицах (копейках). Здесь — форматирование в рубли/доллары и т.п.

export function formatMoney(
  minor: number,
  currency = "RUB",
  minorUnit = 2
): string {
  const major = minor / Math.pow(10, minorUnit);
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: minorUnit,
      maximumFractionDigits: minorUnit,
    }).format(major);
  } catch {
    return `${major.toLocaleString("ru-RU")} ${currency}`;
  }
}

// Парсит ввод "1 234,56" → 123456 (минорные единицы)
export function parseMoney(input: string, minorUnit = 2): number {
  const normalized = input.replace(/\s/g, "").replace(",", ".");
  const value = parseFloat(normalized);
  if (isNaN(value)) return 0;
  return Math.round(value * Math.pow(10, minorUnit));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
