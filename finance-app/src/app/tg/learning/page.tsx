"use client";

import { useCallback, useEffect, useState } from "react";
import Script from "next/script";
import LessonVideo from "@/components/kb/LessonVideo";
import type { Timecode } from "@/lib/kb-video";

// ---- Типы Telegram WebApp (минимально) ----
type TgWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  ready: () => void;
  expand: () => void;
  MainButton?: { hide: () => void };
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

type CourseSummary = {
  id: string;
  title: string;
  cover_url: string | null;
  done: number;
  total: number;
  pct: number;
  allDone: boolean;
  due: string | null;
};
type Lesson = { itemId: string; articleId: string; title: string; kind: string; done: boolean };
type CourseDetail = { id: string; title: string; description: string; lessons: Lesson[]; doneCount: number; total: number; pct: number };
type LessonDetail = { id: string; title: string; kind: string; bodyHtml: string; videoUrl: string | null; timecodes: Timecode[] };

type View =
  | { name: "loading" }
  | { name: "link" }
  | { name: "list" }
  | { name: "course"; course: CourseDetail }
  | { name: "lesson"; course: CourseDetail; lesson: LessonDetail };

const ERR_LABELS: Record<string, string> = {
  bot_not_configured: "Бот ещё не настроен администратором.",
  service_unavailable: "Сервис временно недоступен.",
  bad_signature: "Не удалось подтвердить Telegram. Откройте Mini App заново.",
  expired: "Сессия Telegram устарела. Откройте Mini App заново.",
  no_init_data: "Откройте эту страницу из Telegram.",
};

export default function TgLearningPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [view, setView] = useState<View>({ name: "loading" });
  const [name, setName] = useState<string>("");
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [today, setToday] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Инициализация Telegram SDK.
  const initTg = useCallback(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) {
      // Не в Telegram — покажем подсказку.
      setInitData("");
      setSdkReady(true);
      return;
    }
    try {
      wa.ready();
      wa.expand();
      if (wa.colorScheme === "dark") document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    } catch {
      /* noop */
    }
    setInitData(wa.initData || "");
    setSdkReady(true);
  }, []);

  useEffect(() => {
    if (window.Telegram?.WebApp) initTg();
  }, [initTg]);

  // Универсальный POST к TG-роутам.
  const call = useCallback(
    async (path: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch(`/api/tg/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: initData ?? "", ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data } as { ok: boolean; status: number; data: any };
    },
    [initData],
  );

  // Загрузка сводки после готовности SDK.
  const loadMe = useCallback(async () => {
    setError(null);
    const { ok, data } = await call("me");
    if (!ok) {
      setError(ERR_LABELS[data?.error] ?? "Не удалось загрузить данные.");
      setView({ name: "link" });
      return;
    }
    if (!data.linked) {
      setName(data.tgName ?? "");
      setView({ name: "link" });
      return;
    }
    setName(data.name ?? "");
    setCourses(data.courses ?? []);
    setToday(data.today ?? "");
    setView({ name: "list" });
  }, [call]);

  useEffect(() => {
    if (sdkReady && initData !== null) loadMe();
  }, [sdkReady, initData, loadMe]);

  async function openCourse(id: string) {
    setView({ name: "loading" });
    const { ok, data } = await call("course", { courseId: id });
    if (!ok) {
      setError(ERR_LABELS[data?.error] ?? "Курс недоступен.");
      setView({ name: "list" });
      return;
    }
    setView({ name: "course", course: data as CourseDetail });
  }

  async function openLesson(course: CourseDetail, articleId: string) {
    setView({ name: "loading" });
    const { ok, data } = await call("lesson", { articleId });
    if (!ok) {
      setError(ERR_LABELS[data?.error] ?? "Урок недоступен.");
      setView({ name: "course", course });
      return;
    }
    setView({ name: "lesson", course, lesson: data as LessonDetail });
  }

  async function completeLesson(course: CourseDetail, itemId: string) {
    const { ok } = await call("complete", { itemId });
    if (!ok) return;
    // Обновляем локально и перезагружаем курс.
    await openCourse(course.id);
  }

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onLoad={initTg} />

      {view.name === "loading" && <Centered>Загрузка…</Centered>}

      {view.name === "link" && (
        <LinkScreen initData={initData ?? ""} tgName={name} error={error} onLinked={loadMe} />
      )}

      {view.name === "list" && (
        <CourseList name={name} courses={courses} today={today} error={error} onOpen={openCourse} />
      )}

      {view.name === "course" && (
        <CourseScreen
          course={view.course}
          onBack={() => setView({ name: "list" })}
          onOpenLesson={(aid) => openLesson(view.course, aid)}
          onComplete={(itemId) => completeLesson(view.course, itemId)}
        />
      )}

      {view.name === "lesson" && (
        <LessonScreen
          lesson={view.lesson}
          onBack={() => setView({ name: "course", course: view.course })}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">{children}</div>;
}

// ---- Экран привязки ----
function LinkScreen({
  initData,
  tgName,
  error,
  onLinked,
}: {
  initData: string;
  tgName: string;
  error: string | null;
  onLinked: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/tg/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, email, code }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const m: Record<string, string> = {
        invalid_code: "Неверный код или email.",
        code_expired: "Код истёк — сгенерируйте новый в профиле.",
        missing_fields: "Заполните email и код.",
      };
      setMsg(m[data?.error] ?? "Не удалось привязать. Проверьте данные.");
      return;
    }
    onLinked();
  }

  return (
    <div>
      <h1 className="text-xl font-bold">Обучение</h1>
      {tgName && <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Telegram: {tgName}</p>}
      <p className="mt-3 text-sm text-slate-600 dark:text-neutral-300">
        Чтобы открыть свои курсы, привяжите рабочую учётку.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-500 dark:text-neutral-400">
        <li>Откройте веб-приложение → <b>Профиль</b> → <b>Telegram</b> → «Привязать».</li>
        <li>Введите ваш рабочий email и полученный код ниже.</li>
      </ol>

      {(error || msg) && (
        <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {msg ?? error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <input
          type="email"
          inputMode="email"
          autoCapitalize="off"
          placeholder="Рабочий email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input w-full"
        />
        <input
          type="text"
          placeholder="Код привязки"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="input w-full font-mono tracking-widest"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !email || !code || !initData}
          className="btn-primary w-full"
        >
          {busy ? "Привязываем…" : "Привязать"}
        </button>
        {!initData && (
          <p className="text-center text-xs text-amber-600">Откройте эту страницу из Telegram-бота.</p>
        )}
      </div>
    </div>
  );
}

// ---- Список курсов ----
function CourseList({
  name,
  courses,
  today,
  error,
  onOpen,
}: {
  name: string;
  courses: CourseSummary[];
  today: string;
  error: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div>
      <h1 className="text-xl font-bold">Моё обучение</h1>
      {name && <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{name}</p>}
      {error && (
        <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>
      )}

      {courses.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">Вам пока не назначены курсы.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {courses.map((c) => {
            const overdue = !c.allDone && c.due && c.due < today;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="surface flex w-full flex-col rounded-2xl p-4 text-left active:opacity-80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{c.title}</span>
                    {c.allDone ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">✓</span>
                    ) : overdue ? (
                      <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">просрочено</span>
                    ) : null}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${c.pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs text-slate-500 dark:text-neutral-400">
                    <span>Пройдено {c.done} из {c.total}</span>
                    <span className="font-medium">{c.pct}%</span>
                  </div>
                  {c.due && !c.allDone && <div className="mt-1 text-[11px] text-slate-400">срок до {c.due}</div>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- Экран курса (список уроков) ----
function CourseScreen({
  course,
  onBack,
  onOpenLesson,
  onComplete,
}: {
  course: CourseDetail;
  onBack: () => void;
  onOpenLesson: (articleId: string) => void;
  onComplete: (itemId: string) => void;
}) {
  return (
    <div>
      <button type="button" onClick={onBack} className="text-sm text-slate-400">← Мои курсы</button>
      <h1 className="mt-2 text-xl font-bold">{course.title}</h1>
      {course.description && <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{course.description}</p>}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-brand" style={{ width: `${course.pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Пройдено {course.doneCount} из {course.total} ({course.pct}%)</p>

      <ul className="mt-4 space-y-2">
        {course.lessons.map((l, i) => (
          <li key={l.itemId} className="surface rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  l.done ? "bg-brand text-white" : "bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500"
                }`}
              >
                {l.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpenLesson(l.articleId)} className="text-left font-medium text-slate-900 dark:text-white">
                  {l.title}
                </button>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => onOpenLesson(l.articleId)} className="btn-ghost text-xs">Открыть</button>
                  {!l.done && (
                    <button type="button" onClick={() => onComplete(l.itemId)} className="btn-primary text-xs">Пройдено</button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Экран урока (контент) ----
function LessonScreen({ lesson, onBack }: { lesson: LessonDetail; onBack: () => void }) {
  return (
    <div>
      <button type="button" onClick={onBack} className="text-sm text-slate-400">← К курсу</button>
      <h1 className="mt-2 text-xl font-bold">{lesson.title}</h1>

      {lesson.videoUrl && (
        <div className="mt-4">
          <LessonVideo embedUrl={lesson.videoUrl} timecodes={lesson.timecodes} />
        </div>
      )}

      {lesson.bodyHtml && (
        <article
          className="kb-content mt-4 text-sm leading-relaxed text-slate-700 dark:text-neutral-300"
          dangerouslySetInnerHTML={{ __html: lesson.bodyHtml }}
        />
      )}

      <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-white/[0.03] dark:text-neutral-400">
        Если к материалу есть проверка знаний — пройдите её в веб-приложении.
      </div>
    </div>
  );
}
