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
  // Дату-только («2026-03-01») парсим в локальной зоне, иначе в браузерах западнее UTC
  // дата съезжает на день назад (UTC-полночь → предыдущие сутки локально).
  const s = iso.length === 10 ? `${iso}T00:00:00` : iso;
  return new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
