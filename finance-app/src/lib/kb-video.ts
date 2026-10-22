// Видео урока (Loom) и тайм-коды.

export type Timecode = { t: string; label: string };

// "1:12" → 72, "1:02:03" → 3723. Возвращает null при некорректном вводе.
export function parseTimecode(t: string): number | null {
  const parts = t.trim().split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  const sec = n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  return Number.isFinite(sec) ? sec : null;
}

// Нормализует ссылку Loom (share/embed) в embed-URL. null — если это не Loom.
export function loomEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)loom\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:share|embed)\/([0-9a-f]{16,})/i);
    if (!m) return null;
    return `https://www.loom.com/embed/${m[1]}`;
  } catch {
    return null;
  }
}
