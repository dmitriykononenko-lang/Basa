import sanitizeHtml from "sanitize-html";

// Разрешённые хосты для встраивания видео (Loom / YouTube / Vimeo).
const IFRAME_HOSTS = [
  "www.loom.com",
  "loom.com",
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "vimeo.com",
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "video",
    "source",
    "iframe",
    "figure",
    "figcaption",
    "h1",
    "h2",
    "u",
    "s",
    "mark",
    "small",
    "details",
    "summary",
    "section",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel", "style", "class"],
    img: ["src", "alt", "title", "width", "height", "style", "class"],
    video: ["src", "controls", "width", "height", "poster", "style", "class"],
    source: ["src", "type"],
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "style", "class"],
    td: ["colspan", "rowspan", "style", "class"],
    th: ["colspan", "rowspan", "style", "class", "scope"],
    table: ["style", "class", "border", "cellpadding", "cellspacing"],
    // Разрешаем базовое форматирование (стили/классы) на любых тегах — для вставленного HTML.
    // Скрипты, on*-обработчики и опасные схемы остаются запрещёнными (их нет в allowlist).
    "*": ["style", "class", "id", "align"],
  },
  // Ограничиваем CSS в style безопасными свойствами (без url()/expression и т.п.).
  allowedStyles: {
    "*": {
      color: [/.*/],
      "background-color": [/.*/],
      background: [/.*/],
      "text-align": [/.*/],
      "font-size": [/.*/],
      "font-weight": [/.*/],
      "font-style": [/.*/],
      "text-decoration": [/.*/],
      width: [/.*/],
      height: [/.*/],
      "max-width": [/.*/],
      margin: [/.*/],
      padding: [/.*/],
      border: [/.*/],
      "border-radius": [/.*/],
      "border-collapse": [/.*/],
      "vertical-align": [/.*/],
      display: [/.*/],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowedIframeHostnames: IFRAME_HOSTS,
  // запрещаем любые on*-атрибуты и script автоматически (их нет в allowlist)
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

export function sanitizeRichHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return sanitizeHtml(dirty, OPTIONS);
}

// Текстовый превью (для списков): убрать теги, схлопнуть пробелы.
export function htmlToPreviewText(html: string | null | undefined, max = 180): string {
  if (!html) return "";
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}
