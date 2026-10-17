// Утилита склейки классов (как в shadcn, без лишних зависимостей).
// Явные классы-цвета побеждают, потому что у них выше специфичность, чем у базового слоя.
export function cn(...inputs: Array<string | number | null | undefined | false>): string {
  return inputs.filter(Boolean).join(" ");
}
