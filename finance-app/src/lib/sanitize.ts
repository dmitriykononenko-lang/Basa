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
  // Разрешаем полный набор свойств вёрстки/типографики, чтобы вставленный HTML
  // выглядел как задумано (цвета, фоны, градиенты, сетки, тени, отступы, шрифты).
  // Значение не может содержать скрипт: sanitize-html парсит CSS и отбрасывает
  // невалидное/опасное (expression, поведение и т.п.), а schemes ограничены ниже.
  allowedStyles: {
    "*": Object.fromEntries(
      [
        "color", "background", "background-color", "background-image", "background-position",
        "background-size", "background-repeat", "background-clip", "-webkit-background-clip",
        "-webkit-text-fill-color", "opacity", "box-shadow", "filter", "backdrop-filter",
        "border", "border-top", "border-right", "border-bottom", "border-left",
        "border-color", "border-width", "border-style", "border-radius", "border-collapse", "border-spacing",
        "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
        "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
        "width", "height", "min-width", "min-height", "max-width", "max-height",
        "display", "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
        "align-items", "align-content", "align-self", "justify-content", "justify-items", "justify-self",
        "gap", "row-gap", "column-gap", "order",
        "grid", "grid-template", "grid-template-columns", "grid-template-rows",
        "grid-column", "grid-row", "grid-gap", "grid-auto-flow",
        "position", "top", "right", "bottom", "left", "z-index", "float", "clear",
        "overflow", "overflow-x", "overflow-y", "object-fit", "aspect-ratio",
        "text-align", "text-transform", "text-decoration", "text-indent", "text-shadow",
        "letter-spacing", "line-height", "white-space", "word-break", "overflow-wrap", "word-wrap",
        "font", "font-size", "font-weight", "font-style", "font-family", "font-variant",
        "list-style", "list-style-type", "vertical-align", "cursor", "table-layout",
      ].map((p) => [p, [/.*/]]),
    ),
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
