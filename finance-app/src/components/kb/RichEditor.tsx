"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import {
  IconBold,
  IconItalic,
  IconHeading,
  IconListBullet,
  IconListOrdered,
  IconLink,
  IconImage,
  IconVideo,
  IconEmbed,
} from "@/components/icons";

// --- кастомный узел <video controls> ---
const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, controls: { default: true } };
  },
  parseHTML() {
    return [{ tag: "video" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes, { controls: "controls", class: "kb-video" })];
  },
});

// --- кастомный узел встраивания (iframe в обёртке .kb-embed) ---
const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div.kb-embed" }, { tag: "iframe" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { class: "kb-embed" },
      [
        "iframe",
        mergeAttributes(HTMLAttributes, {
          frameborder: "0",
          allowfullscreen: "true",
          allow: "fullscreen; picture-in-picture",
        }),
      ],
    ];
  },
});

// --- произвольный HTML-блок: хранит и рендерит HTML как есть (таблицы, разметка) ---
const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div.kb-raw", getAttrs: (el) => ({ html: (el as HTMLElement).innerHTML }) }];
  },
  renderHTML({ node }) {
    if (typeof document === "undefined") return ["div", { class: "kb-raw" }];
    const dom = document.createElement("div");
    dom.className = "kb-raw";
    dom.innerHTML = (node.attrs.html as string) || "";
    return dom;
  },
});

// Базовая очистка вставляемого HTML: убираем скрипты и inline-обработчики.
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

// Нормализуем ссылку на видео в embed-URL (Loom / YouTube / Vimeo).
function toEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "loom.com") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.loom.com/embed/${id}` : null;
    }
    if (host === "youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === "player.vimeo.com") return raw;
    return null;
  } catch {
    return null;
  }
}

export default function RichEditor({
  value,
  onChange,
  teamId,
  compact = false,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  teamId: string;
  compact?: boolean;
  placeholder?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Video,
      Embed,
      RawHtml,
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: `kb-content kb-editor focus:outline-none ${compact ? "min-h-[80px]" : "min-h-[220px]"}`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // если value меняется извне (загрузка существующей статьи) — синхронизируем
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) {
    return <div className="input min-h-[120px] animate-pulse" />;
  }

  async function upload(file: File): Promise<string | null> {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${teamId}/${crypto.randomUUID()}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("kb-media").upload(path, file, {
      cacheControl: "31536000",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (error) {
      toast.error(error.message);
      return null;
    }
    return supabase.storage.from("kb-media").getPublicUrl(path).data.publicUrl;
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const url = await upload(file);
    setUploading(false);
    if (url) editor!.chain().focus().setImage({ src: url }).run();
  }

  async function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const url = await upload(file);
    setUploading(false);
    if (url) editor!.chain().focus().insertContent({ type: "video", attrs: { src: url } }).run();
  }

  function addEmbed() {
    const raw = window.prompt("Ссылка на видео (Loom, YouTube, Vimeo):");
    if (!raw) return;
    const src = toEmbedUrl(raw);
    if (!src) {
      toast.error("Поддерживаются ссылки Loom, YouTube, Vimeo");
      return;
    }
    editor!.chain().focus().insertContent({ type: "embed", attrs: { src } }).run();
  }

  function insertHtml() {
    const clean = sanitizeHtml(htmlDraft).trim();
    if (clean) editor!.chain().focus().insertContent({ type: "rawHtml", attrs: { html: clean } }).run();
    setHtmlOpen(false);
    setHtmlDraft("");
  }

  function addLink() {
    const url = window.prompt("URL ссылки:");
    if (url === null) return;
    if (url === "") {
      editor!.chain().focus().unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const Btn = ({ on, active, title, children }: { on: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={`flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium transition ${
        active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white/95 p-1.5 backdrop-blur dark:border-white/10 dark:bg-[#15171c]/95">
        <Btn title="Жирный" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}><IconBold className="h-4 w-4" /></Btn>
        <Btn title="Курсив" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}><IconItalic className="h-4 w-4" /></Btn>
        {!compact && (
          <>
            <Btn title="Заголовок" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><IconHeading className="h-4 w-4" /></Btn>
            <Btn title="Маркированный список" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}><IconListBullet className="h-4 w-4" /></Btn>
            <Btn title="Нумерованный список" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}><IconListOrdered className="h-4 w-4" /></Btn>
          </>
        )}
        <Btn title="Ссылка" active={editor.isActive("link")} on={addLink}><IconLink className="h-4 w-4" /></Btn>
        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
        <Btn title="Изображение / GIF" on={() => imgInput.current?.click()}><IconImage className="h-4 w-4" /></Btn>
        <Btn title="Загрузить видео" on={() => vidInput.current?.click()}><IconVideo className="h-4 w-4" /></Btn>
        <Btn title="Вставить видео по ссылке (Loom, YouTube, Vimeo)" on={addEmbed}>
          <IconEmbed className="h-4 w-4" />
          <span className="hidden text-xs sm:inline">Видео по ссылке</span>
        </Btn>
        {!compact && (
          <Btn title="Вставить HTML-код" on={() => setHtmlOpen(true)}>
            <span className="font-mono text-xs">&lt;/&gt;</span>
            <span className="hidden text-xs sm:inline">HTML</span>
          </Btn>
        )}
        {uploading && <span className="ml-2 text-xs text-slate-400">загрузка…</span>}
        <input ref={imgInput} type="file" accept="image/*" hidden onChange={onPickImage} />
        <input ref={vidInput} type="file" accept="video/*" hidden onChange={onPickVideo} />
      </div>
      <EditorContent editor={editor} className="px-3 py-2" />
      {placeholder && editor.isEmpty && (
        <div className="pointer-events-none -mt-9 px-3 text-sm text-slate-400">{placeholder}</div>
      )}

      {htmlOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHtmlOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl dark:bg-[#15171c]" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-bold text-slate-900 dark:text-white">Вставить HTML-код</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-neutral-400">
              Блок отобразится как есть (таблицы, разметка, iframe). Скрипты и обработчики удаляются автоматически.
            </p>
            <textarea
              autoFocus
              value={htmlDraft}
              onChange={(e) => setHtmlDraft(e.target.value)}
              placeholder="<table>…</table>  ·  <div style=…>…</div>  ·  <iframe …></iframe>"
              className="input min-h-[220px] w-full font-mono text-xs"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => { setHtmlOpen(false); setHtmlDraft(""); }}>Отмена</button>
              <button type="button" className="btn-primary" disabled={!htmlDraft.trim()} onClick={insertHtml}>Вставить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
