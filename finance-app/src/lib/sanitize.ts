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
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "style", "class"],
    video: ["src", "controls", "width", "height", "poster", "style", "class"],
    source: ["src", "type"],
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "style", "class"],
    div: ["class"],
    "*": [],
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
