"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { sealForTeam } from "@/lib/intake-crypto";
import {
  accountFieldLabel, cleanPayload, emptyPayload, isUserAddService, serviceTitle, validatePayload,
  TWOFA_METHODS, MAX_EXTRAS, emptyExtra, receiptLines,
  type IntakeExtra, type IntakePayload, type IntakeServiceKind, type TwoFaMethod,
} from "@/lib/intake-form";

// Страница клиента «Передача доступа» (бренд KO Agency).
// Слева — кто и зачем просит доступ и как защищены данные; справа — форма по шагам.
// Логика: токен из # → /api/intake/load → форма → шифрование в браузере → /api/intake/submit.

type Loaded = {
  status: "ok";
  request_id: string;
  service_kind: IntakeServiceKind;
  service_label: string;
  client_name: string;
  requester_name: string;
  expires_at: string;
  key_id: string;
  public_key: string;
  agency: { email: string; metaBusinessId: string; googleManagerId: string };
};

type ClosedReason = "invalid" | "expired" | "used" | "revoked" | "nolink" | "error";
type Phase =
  | { k: "loading" }
  | { k: "closed"; reason: ClosedReason }
  | { k: "form"; data: Loaded }
  | { k: "done"; receipt: Receipt; data: Loaded };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const STORE_KEY = "ko-intake-token";
const RED = "#e60000";
const EASE = [0.16, 1, 0.3, 1] as const;

const CLOSED_TEXT: Record<ClosedReason, { title: string; body: string }> = {
  invalid: { title: "Ссылка не найдена", body: "Проверьте, что открыли ссылку полностью, или попросите менеджера KO Agency прислать новую." },
  nolink: { title: "Откройте ссылку из сообщения", body: "Страница открывается только по персональной ссылке от менеджера KO Agency." },
  expired: { title: "Срок ссылки истёк", body: "Ссылка действует 48 часов. Попросите менеджера KO Agency прислать новую." },
  used: { title: "Данные уже переданы", body: "По этой ссылке доступ уже отправлен. Если нужно что-то изменить, напишите менеджеру — он пришлёт новую ссылку." },
  revoked: { title: "Ссылка отозвана", body: "Менеджер KO Agency закрыл эту ссылку. Если доступ всё ещё нужно передать, попросите новую." },
  error: { title: "Не удалось открыть страницу", body: "Обновите страницу через минуту. Если не помогло — напишите менеджеру KO Agency." },
};

// ---------- иконки (inline SVG, без внешних зависимостей) ----------
const Ico = ({ d, className = "h-4 w-4" }: { d: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {d}
  </svg>
);
const LockIco = (p: { className?: string }) => <Ico {...p} d={<><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>} />;
const CheckIco = (p: { className?: string }) => <Ico {...p} d={<path d="M5 12.5l4.2 4.2L19 7" />} />;
const CopyIco = (p: { className?: string }) => <Ico {...p} d={<><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8" /></>} />;
const EyeIco = (p: { className?: string }) => <Ico {...p} d={<><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>} />;
const EyeOffIco = (p: { className?: string }) => <Ico {...p} d={<><path d="M3 3l18 18" /><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.1 3.9M6.3 6.9C3.9 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 0 0 4.1-.9" /><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2" /></>} />;
const ArrowIco = (p: { className?: string }) => <Ico {...p} d={<path d="M5 12h13m-5-5 5 5-5 5" />} />;
const KeyIco = (p: { className?: string }) => <Ico {...p} d={<><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5 19 4m-3 3 2.5 2.5M14 9l2 2" /></>} />;
const BrowserIco = (p: { className?: string }) => <Ico {...p} d={<><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" /></>} />;

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Оставшееся время ссылки, обновляется раз в 30 секунд.
function useRemaining(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "срок истёк";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} ч ${m.toString().padStart(2, "0")} мин` : `${m} мин`;
}

export default function IntakeClient() {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [token, setToken] = useState<string>("");
  const started = useRef(false);

  useEffect(() => {
    // Одно открытие на загрузку страницы (в dev React вызывает эффект дважды).
    if (started.current) return;
    started.current = true;
    // Токен из фрагмента (#) → в память и sessionStorage вкладки; из адресной строки убираем.
    let t = "";
    const h = window.location.hash.replace(/^#/, "");
    if (TOKEN_RE.test(h)) {
      t = h;
      try { sessionStorage.setItem(STORE_KEY, t); } catch {}
      // сохраняем state роутера Next, иначе он вернёт старый адрес с токеном при следующем обновлении
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } else {
      try { t = sessionStorage.getItem(STORE_KEY) ?? ""; } catch {}
    }
    if (!TOKEN_RE.test(t)) {
      setPhase({ k: "closed", reason: "nolink" });
      return;
    }
    setToken(t);
    fetch("/api/intake/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.status === "ok") setPhase({ k: "form", data: d as Loaded });
        else setPhase({ k: "closed", reason: (["invalid", "expired", "used", "revoked"].includes(d?.status) ? d.status : "error") });
      })
      .catch(() => setPhase({ k: "closed", reason: "error" }));
  }, []);

  const data = phase.k === "form" || phase.k === "done" ? phase.data : null;

  return (
    <div className="min-h-[100dvh] bg-[#f3f3f1] text-[#141414] antialiased md:grid md:grid-cols-[minmax(340px,5fr)_7fr]">
      <Aside data={data} phase={phase.k} />
      <main className="px-4 pb-16 pt-8 sm:px-8 md:px-12 md:pt-16 lg:px-20">
        <div className="mx-auto max-w-[640px] md:mx-0">
          <AnimatePresence mode="wait">
            {phase.k === "loading" && <Skeleton key="loading" />}
            {phase.k === "closed" && <Closed key="closed" reason={phase.reason} />}
            {phase.k === "form" && (
              <IntakeForm
                key="form"
                data={phase.data}
                token={token}
                onDone={(receipt) => {
                  try { sessionStorage.removeItem(STORE_KEY); } catch {}
                  setPhase({ k: "done", receipt, data: phase.data });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onClosed={(reason) => setPhase({ k: "closed", reason })}
              />
            )}
            {phase.k === "done" && <Done key="done" receipt={phase.receipt} data={phase.data} />}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ---------- левая колонка: контекст и доверие ----------
function Aside({ data, phase }: { data: Loaded | null; phase: Phase["k"] }) {
  const remaining = useRemaining(phase === "form" ? data?.expires_at : undefined);
  // показываем реальный адрес страницы — клиент сверяет его с адресом в сообщении
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);
  const reduce = useReducedMotion();
  return (
    <aside className="relative overflow-hidden bg-[#0e0e0e] text-white md:sticky md:top-0 md:h-[100dvh]">
      {/* фирменные «две точки» KO как крупная графика фона */}
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-20 hidden gap-6 opacity-[0.05] md:flex">
        <span className="h-64 w-64 rounded-full bg-white" />
        <span className="h-64 w-64 rounded-full bg-white" />
      </div>

      <div className="relative flex h-full flex-col px-5 pb-8 pt-6 sm:px-8 md:px-10 md:pb-10 md:pt-10 lg:px-14">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ko-agency-wordmark.svg" alt="KO Agency" className="h-[18px] w-auto md:h-5" />
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <LockIco className="h-3 w-3" />
            {host}
          </span>
        </div>

        <div className="mt-10 md:mt-auto">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">Передача доступа</p>
          {data ? (
            <h1 className="mt-3 text-[34px] font-semibold leading-[1.05] tracking-tight md:text-5xl">
              {serviceTitle(data.service_kind, data.service_label)}
              {data.client_name && <span className="block text-white/35">для {data.client_name}</span>}
            </h1>
          ) : (
            <h1 className="mt-3 text-[34px] font-semibold leading-[1.05] tracking-tight md:text-5xl">Защищённая передача доступа</h1>
          )}

          {data && (
            <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border-t border-white/10 pt-6 text-sm">
              <dt className="text-white/40">Запросил</dt>
              <dd>{data.requester_name}, KO Agency</dd>
              <dt className="text-white/40">Действует до</dt>
              <dd className="flex flex-wrap items-center gap-x-2">
                {fmtDate(data.expires_at)}
                {phase === "form" && remaining && (
                  <span className="inline-flex items-center gap-1.5 text-white/50">
                    <span className="relative flex h-1.5 w-1.5">
                      {!reduce && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: RED }} />}
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: RED }} />
                    </span>
                    осталось {remaining}
                  </span>
                )}
              </dd>
            </dl>
          )}
        </div>

        <ol className="mt-10 hidden space-y-4 text-sm md:block">
          {[
            { i: <BrowserIco />, t: "Вы вводите данные на этой странице" },
            { i: <LockIco />, t: "Браузер шифрует их до отправки — на сервер уходит только шифр" },
            { i: <KeyIco />, t: "Открыть их может только KO Agency в своей парольнице" },
          ].map((s, n) => (
            <li key={n} className="grid grid-cols-[32px_1fr] items-start gap-3 text-white/60">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/80">{s.i}</span>
              <span className="pt-1.5 leading-snug">{s.t}</span>
            </li>
          ))}
        </ol>
        <p className="mt-8 hidden max-w-[42ch] text-xs leading-relaxed text-white/35 md:block">
          Мы никогда не просим присылать коды из SMS в чат и не спрашиваем пароли от вашей почты или Telegram.
        </p>
      </div>
    </aside>
  );
}

// ---------- состояния ----------
const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.2 } },
};

function Skeleton() {
  return (
    <motion.div {...fade} className="space-y-8" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-t border-black/10 pt-6">
          <div className="h-3 w-16 animate-pulse rounded bg-black/10" />
          <div className="mt-4 h-5 w-2/3 animate-pulse rounded bg-black/10" />
          <div className="mt-5 h-12 w-full animate-pulse rounded-xl bg-black/[0.06]" />
        </div>
      ))}
    </motion.div>
  );
}

function Closed({ reason }: { reason: ClosedReason }) {
  const t = CLOSED_TEXT[reason];
  return (
    <motion.section {...fade} className="border-t border-black/10 pt-6 md:mt-[18vh]">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#141414] text-white">
        <LockIco className="h-5 w-5" />
      </span>
      <h2 className="mt-6 text-2xl font-semibold tracking-tight md:text-3xl">{t.title}</h2>
      <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-black/60">{t.body}</p>
    </motion.section>
  );
}

type Receipt = { userMode: boolean; lines: { title: string; detail: string }[]; at: string };

function receiptCode(id: string) {
  const h = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `KO-${h.slice(0, 4)}-${h.slice(4)}`;
}

function Done({ receipt, data }: { receipt: Receipt; data: Loaded }) {
  const reduce = useReducedMotion();
  const steps = [
    "Зашифровано в вашем браузере",
    "Передано в парольницу KO Agency",
    "Ссылка закрыта — открыть её повторно нельзя",
  ];
  const item = (i: number) => ({
    initial: reduce ? false : { opacity: 0, x: -8 },
    animate: { opacity: 1, x: 0, transition: { delay: 0.25 + i * 0.35, duration: 0.45, ease: EASE } },
  });
  return (
    <motion.section {...fade} className="space-y-10 md:mt-[6vh]">
      <div className="border-t border-black/10 pt-6">
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="flex h-12 w-12 items-center justify-center rounded-full text-white"
          style={{ background: RED }}
        >
          <CheckIco className="h-6 w-6" />
        </motion.span>
        <h2 className="mt-6 text-3xl font-semibold tracking-tight md:text-4xl">Доступ передан</h2>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-black/60">
          {receipt.userMode && receipt.lines.length === 1
            ? "Мы получили отметку, что вы добавили нас. Пароль никуда не передавался."
            : "Данные ушли в зашифрованном виде — в чате и на почте их нет."}
        </p>
        <ul className="mt-6 space-y-2.5">
          {steps.map((t, i) => (
            <motion.li key={t} {...item(i)} className="flex items-center gap-3 text-[15px]">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#141414] text-white">
                <CheckIco className="h-3.5 w-3.5" />
              </span>
              {t}
            </motion.li>
          ))}
        </ul>
      </div>

      {/* квитанция — без логинов и паролей */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.25 + steps.length * 0.35, duration: 0.6, ease: EASE } }}
        className="relative overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-30px_rgba(20,20,20,0.35)] print:shadow-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-5 pt-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-black/40">Квитанция о передаче</p>
            <p className="mt-1 font-mono text-lg tracking-wide">{receiptCode(data.request_id)}</p>
          </div>
          <div className="text-right text-xs leading-relaxed text-black/50">
            <div>{receipt.at}</div>
            {data.client_name && <div>{data.client_name}</div>}
          </div>
        </div>
        <div aria-hidden className="relative h-px">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-[#f3f3f1]" />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-[#f3f3f1]" />
          <div className="mx-6 border-t border-dashed border-black/15" />
        </div>
        <ul className="divide-y divide-black/[0.06] px-6 py-2">
          {receipt.lines.map((l, i) => (
            <li key={i} className="grid grid-cols-[20px_1fr] gap-3 py-3.5">
              <LockIco className="mt-0.5 h-4 w-4 text-black/35" />
              <div>
                <div className="text-[15px] font-medium">{l.title}</div>
                <div className="text-sm text-black/50">{l.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#141414] px-6 py-4 text-xs text-white/60">
          <span>Получатель: KO Agency · {data.requester_name}</span>
          <span>Логины и пароли в квитанции не показываются</span>
        </div>
      </motion.div>

      <div className="border-t border-black/10 pt-6">
        <h3 className="text-lg font-semibold tracking-tight">Что дальше</h3>
        <ol className="mt-4 space-y-3">
          {[
            `${data.requester_name} проверит доступ и напишет вам в рабочий чат.`,
            "Если для входа понадобится код подтверждения, мы предупредим заранее. Коды в чат не присылайте.",
            "Отозвать доступ можно в любой момент: удалите пользователя KO Agency или смените пароль — и сообщите нам.",
          ].map((t, i) => (
            <li key={i} className="grid grid-cols-[24px_1fr] gap-3 text-[15px] leading-relaxed text-black/70">
              <span className="mt-[3px] flex h-6 w-6 items-center justify-center rounded-full border border-black/15 font-mono text-[11px] text-black/50">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-4 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-medium transition hover:border-black/40 active:scale-[0.98]"
          >
            Сохранить квитанцию
          </button>
          <span className="text-sm text-black/40">Страницу можно закрыть.</span>
        </div>
      </div>
    </motion.section>
  );
}

// ---------- поля ----------
function Step({ n, title, hint, children }: { n: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <motion.section
      variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }}
      className="grid gap-x-6 border-t border-black/10 pt-6 sm:grid-cols-[56px_1fr]"
    >
      <span className="font-mono text-xs tabular-nums text-black/35 sm:pt-1">{n}</span>
      <div className="mt-2 sm:mt-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-black/50">{hint}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </motion.section>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-black/80">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-black/45">{hint}</span>}
      <AnimatePresence initial={false}>
        {error && (
          <motion.span
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            data-field-error
            className="text-xs font-medium"
            style={{ color: RED }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  );
}

const inputCls = (bad?: boolean) =>
  `block w-full rounded-xl border bg-white px-3.5 py-3 text-[15px] outline-none transition-[border-color,box-shadow] duration-300 placeholder:text-black/30 focus:border-[#141414] focus:shadow-[0_0_0_3px_rgba(20,20,20,0.08)] ${bad ? "border-[#e60000]/60" : "border-black/[0.12]"}`;

function CopyChip({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setOk(true);
          setTimeout(() => setOk(false), 1600);
        } catch {}
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#141414] px-2 py-0.5 align-middle font-mono text-[13px] text-white transition active:scale-[0.97]"
      title="Скопировать"
    >
      {value}
      {ok ? <CheckIco className="h-3.5 w-3.5 text-white/80" /> : <CopyIco className="h-3.5 w-3.5 text-white/60" />}
    </button>
  );
}

function Instructions({ kind, agency }: { kind: IntakeServiceKind; agency: Loaded["agency"] }) {
  const email = <CopyChip value={agency.email} />;
  const steps: React.ReactNode[] = [];
  if (kind === "amocrm" || kind === "kommo") {
    const name = kind === "amocrm" ? "amoCRM" : "Kommo";
    steps.push(<>Войдите в {name} под администратором аккаунта.</>);
    steps.push(<>Откройте <b className="font-semibold">Настройки → Пользователи</b> и нажмите <b className="font-semibold">«Добавить пользователя»</b>.</>);
    steps.push(<>Укажите email {email} и включите права <b className="font-semibold">«Администратор»</b>.</>);
    steps.push(<>Сохраните. Если в тарифе нет свободного места, напишите об этом в комментарии — подскажем, как лучше.</>);
  } else if (kind === "meta") {
    if (agency.metaBusinessId) {
      steps.push(<>Откройте <b className="font-semibold">business.facebook.com → Настройки компании → Пользователи → Партнёры</b>.</>);
      steps.push(<>Нажмите <b className="font-semibold">«Добавить» → «Предоставить партнёру доступ к своим ресурсам»</b> и введите ID бизнес-портфолио KO Agency: <CopyChip value={agency.metaBusinessId} /></>);
      steps.push(<>Отметьте нужные ресурсы (рекламный аккаунт, страница, пиксель) и выдайте полный доступ.</>);
    } else {
      steps.push(<>Откройте <b className="font-semibold">business.facebook.com → Настройки компании → Пользователи → Люди</b>.</>);
      steps.push(<>Нажмите <b className="font-semibold">«Пригласить»</b>, укажите email {email} и выберите полный доступ.</>);
      steps.push(<>Назначьте доступ к нужным ресурсам: рекламный аккаунт, страница, пиксель.</>);
    }
  } else if (kind === "google_ads") {
    steps.push(<>Откройте <b className="font-semibold">ads.google.com → Администратор → Доступ и безопасность</b>.</>);
    steps.push(<>Нажмите <b className="font-semibold">«+»</b>, укажите email {email} и уровень доступа <b className="font-semibold">«Администратор»</b>.</>);
    steps.push(<>Нажмите <b className="font-semibold">«Отправить приглашение»</b>.</>);
    if (agency.googleManagerId) steps.push(<>Или примите запрос на привязку к управляющему аккаунту KO Agency <CopyChip value={agency.googleManagerId} /></>);
  }
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[24px_1fr] gap-3 text-[15px] leading-relaxed text-black/75">
          <span className="mt-[3px] flex h-6 w-6 items-center justify-center rounded-full border border-black/15 font-mono text-[11px] text-black/50">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function ExtraCard({
  index, value, errors, onChange, onRemove,
}: {
  index: number;
  value: IntakeExtra;
  errors: Record<string, string>;
  onChange: (patch: Partial<IntakeExtra>) => void;
  onRemove: () => void;
}) {
  const [show, setShow] = useState(false);
  const e = (f: string) => errors[`extras.${index}.${f}`];
  const where = ["sms", "email", "telegram", "other", "app"].includes(value.twofa_method);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 26 } }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_1px_0_rgba(20,20,20,0.03)] sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs text-black/40">Доступ {index + 1}</span>
        <button type="button" onClick={onRemove} className="rounded-lg px-2 py-1 text-xs text-black/45 transition hover:bg-black/5 hover:text-black">
          Убрать
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Сервис" error={e("service_name")}>
          <input className={inputCls(!!e("service_name"))} value={value.service_name} onChange={(ev) => onChange({ service_name: ev.target.value })} maxLength={200} placeholder="Например, Tilda" />
        </Field>
        <Field label="Адрес входа" error={e("url")}>
          <input className={inputCls(!!e("url"))} value={value.url} onChange={(ev) => onChange({ url: ev.target.value })} maxLength={200} spellCheck={false} placeholder="https://" />
        </Field>
        <Field label="Логин" error={e("login")}>
          <input className={inputCls(!!e("login"))} value={value.login} onChange={(ev) => onChange({ login: ev.target.value })} maxLength={200} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field label="Пароль" error={e("password")}>
          <div className="relative">
            <input
              className={`${inputCls(!!e("password"))} pr-12`}
              type={show ? "text" : "password"}
              value={value.password}
              onChange={(ev) => onChange({ password: ev.target.value })}
              maxLength={500}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Скрыть пароль" : "Показать пароль"}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-black/40 transition hover:bg-black/5 hover:text-black"
            >
              {show ? <EyeOffIco /> : <EyeIco />}
            </button>
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Код подтверждения (2FA)">
            <select
              className={inputCls()}
              value={value.twofa_method}
              onChange={(ev) => onChange({ twofa_method: ev.target.value as TwoFaMethod })}
            >
              {TWOFA_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        </div>
        {where && (
          <div className="sm:col-span-2">
            <Field label="Куда приходит и кто может продиктовать код" error={e("twofa_where")}>
              <input className={inputCls(!!e("twofa_where"))} value={value.twofa_where} onChange={(ev) => onChange({ twofa_where: ev.target.value })} maxLength={200} />
            </Field>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------- форма ----------
function IntakeForm({
  data, token, onDone, onClosed,
}: {
  data: Loaded;
  token: string;
  onDone: (receipt: Receipt) => void;
  onClosed: (reason: ClosedReason) => void;
}) {
  const kind = data.service_kind;
  const userAdd = isUserAddService(kind);
  const reduce = useReducedMotion();
  const [p, setP] = useState<IntakePayload>(() => emptyPayload(kind, kind === "other" ? data.service_label : ""));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);
  const set = <K extends keyof IntakePayload>(k: K, v: IntakePayload[K]) => {
    setP((x) => ({ ...x, [k]: v }));
    setErrors((e) => {
      if (!(k in e)) return e;
      const { [k as string]: _gone, ...rest } = e;
      void _gone;
      return rest;
    });
  };
  const passwordMode = !userAdd || p.fallback;
  const needWhere = useMemo(() => ["sms", "email", "telegram", "other", "app"].includes(p.twofa_method), [p.twofa_method]);
  const dropErrors = (prefix: string) =>
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(prefix))));
  const addExtra = () => setP((x) => (x.extras.length >= MAX_EXTRAS ? x : { ...x, extras: [...x.extras, emptyExtra()] }));
  const updExtra = (i: number, patch: Partial<IntakeExtra>) => {
    setP((x) => ({ ...x, extras: x.extras.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
    for (const k of Object.keys(patch)) dropErrors(`extras.${i}.${k}`);
  };
  const removeExtra = (i: number) => {
    setP((x) => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }));
    dropErrors("extras.");
  };
  let step = 0;
  const num = () => String(++step).padStart(2, "0");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const clean = cleanPayload(p);
    const v = validatePayload(clean);
    setErrors(v);
    if (Object.keys(v).length) {
      // показать первую ошибку: она может быть далеко выше кнопки (например, в доп. доступе)
      setTimeout(() => {
        document.querySelector("[data-field-error]")?.closest("label, section")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      }, 60);
      return;
    }
    setBusy(true);
    try {
      const sealed = await sealForTeam(data.public_key, data.key_id, data.request_id, clean);
      const res = await fetch("/api/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, payload: sealed, user_added: clean.user_added, fallback: clean.fallback, extras_count: clean.extras.length }),
        cache: "no-store",
      });
      const d = await res.json().catch(() => ({}));
      if (d?.status === "ok") {
        onDone({
          userMode: userAdd && !clean.fallback,
          lines: receiptLines(clean, data.service_label),
          at: new Date().toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
        });
      }
      else if (["invalid", "expired", "used", "revoked"].includes(d?.status)) onClosed(d.status);
      else setErr("Не удалось отправить. Попробуйте ещё раз через минуту.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Не удалось зашифровать данные.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.form
      onSubmit={submit}
      autoComplete="off"
      noValidate
      initial={reduce ? "show" : "hidden"}
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
      className="space-y-10"
    >
      {userAdd && (
        <Step
          n={num()}
          title={kind === "meta" && data.agency.metaBusinessId ? "Добавьте KO Agency партнёром" : "Добавьте KO Agency пользователем"}
          hint="Так пароль передавать не нужно, а доступ можно в любой момент отключить у себя."
        >
          <AnimatePresence mode="wait" initial={false}>
            {!p.fallback ? (
              <motion.div key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <Instructions kind={kind} agency={data.agency} />
                <Field label={accountFieldLabel(kind)} error={errors.account}>
                  <input className={inputCls(!!errors.account)} value={p.account} onChange={(e) => set("account", e.target.value)} maxLength={200} spellCheck={false} />
                </Field>
                <button
                  type="button"
                  onClick={() => set("user_added", !p.user_added)}
                  aria-pressed={p.user_added}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-[15px] transition active:scale-[0.99] ${
                    p.user_added ? "border-[#141414] bg-[#141414] text-white" : errors.user_added ? "border-[#e60000]/60 bg-white" : "border-black/[0.12] bg-white hover:border-black/30"
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${p.user_added ? "border-white bg-white text-[#141414]" : "border-black/25"}`}>
                    {p.user_added && <CheckIco className="h-3.5 w-3.5" />}
                  </span>
                  Я добавил(а) KO Agency{kind === "meta" && data.agency.metaBusinessId ? " партнёром" : " пользователем"}
                </button>
                {errors.user_added && <p className="-mt-3 text-xs font-medium" style={{ color: RED }}>{errors.user_added}</p>}
              </motion.div>
            ) : (
              <motion.p key="fb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[15px] text-black/60">
                Хорошо, передайте логин и пароль ниже — они тоже зашифруются в вашем браузере.
              </motion.p>
            )}
          </AnimatePresence>
          <button
            type="button"
            className="mt-5 text-sm text-black/45 underline decoration-black/20 underline-offset-4 transition hover:text-black hover:decoration-black"
            onClick={() => { set("fallback", !p.fallback); setErrors({}); }}
          >
            {p.fallback ? "Вернуться к добавлению пользователя" : "Не получается добавить — передать логин и пароль"}
          </button>
        </Step>
      )}

      <AnimatePresence initial={false}>
        {passwordMode && (
          <motion.div key="pw" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } }} exit={{ opacity: 0, y: -6 }}>
            <Step n={num()} title={userAdd ? "Логин и пароль" : "Данные для входа"} hint="Шифруются прямо здесь, до отправки.">
              <div className="grid gap-5 sm:grid-cols-2">
                {kind === "other" && (
                  <div className="sm:col-span-2">
                    <Field label="Сервис" error={errors.service_name}>
                      <input className={inputCls(!!errors.service_name)} value={p.service_name} onChange={(e) => set("service_name", e.target.value)} maxLength={200} />
                    </Field>
                  </div>
                )}
                <div className="sm:col-span-2">
                  {kind === "other" ? (
                    <Field label="Адрес входа" hint="Ссылка на страницу входа, если есть" error={errors.url}>
                      <input className={inputCls(!!errors.url)} value={p.url} onChange={(e) => set("url", e.target.value)} maxLength={200} spellCheck={false} placeholder="https://" />
                    </Field>
                  ) : (
                    <Field label={accountFieldLabel(kind)} error={errors.account}>
                      <input className={inputCls(!!errors.account)} value={p.account} onChange={(e) => set("account", e.target.value)} maxLength={200} spellCheck={false} />
                    </Field>
                  )}
                </div>
                <Field label="Логин" error={errors.login}>
                  <input className={inputCls(!!errors.login)} value={p.login} onChange={(e) => set("login", e.target.value)} maxLength={200} autoComplete="off" autoCapitalize="none" spellCheck={false} />
                </Field>
                <Field label="Пароль" error={errors.password}>
                  <div className="relative">
                    <input
                      className={`${inputCls(!!errors.password)} pr-12`}
                      type={showPw ? "text" : "password"}
                      value={p.password}
                      onChange={(e) => set("password", e.target.value)}
                      maxLength={500}
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-black/40 transition hover:bg-black/5 hover:text-black"
                    >
                      {showPw ? <EyeOffIco /> : <EyeIco />}
                    </button>
                  </div>
                </Field>
              </div>
            </Step>
          </motion.div>
        )}
      </AnimatePresence>

      <Step n={num()} title="Куда приходит код подтверждения" hint="Сами коды и резервные коды не присылайте — перед входом мы свяжемся с вами.">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Способ двухфакторной защиты">
          {TWOFA_METHODS.map((m) => {
            const on = p.twofa_method === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("twofa_method", m.value as TwoFaMethod)}
                className={`rounded-full border px-3.5 py-2 text-sm transition active:scale-[0.97] ${
                  on ? "border-[#141414] bg-[#141414] text-white" : "border-black/[0.12] bg-white text-black/70 hover:border-black/30"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <AnimatePresence initial={false}>
          {needWhere && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto", transition: { duration: 0.35, ease: EASE } }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-5">
                <Field label="Куда приходит и кто может продиктовать код" hint="Например: SMS на номер …-47, Екатерина, офис-менеджер" error={errors.twofa_where}>
                  <input className={inputCls(!!errors.twofa_where)} value={p.twofa_where} onChange={(e) => set("twofa_where", e.target.value)} maxLength={200} />
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Step>

      <Step
        n={num()}
        title="Другие доступы"
        hint="Есть ещё сервисы, к которым нам нужен доступ? Добавьте их сюда — сайт, хостинг, мессенджеры, телефония, любые другие. Всё зашифруется вместе."
      >
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {p.extras.map((x, i) => (
              <ExtraCard
                key={i}
                index={i}
                value={x}
                errors={errors}
                onChange={(patch) => updExtra(i, patch)}
                onRemove={() => removeExtra(i)}
              />
            ))}
          </AnimatePresence>
          {p.extras.length < MAX_EXTRAS ? (
            <button
              type="button"
              onClick={addExtra}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-black/20 bg-transparent px-4 py-4 text-[15px] text-black/60 transition hover:border-black/50 hover:text-black active:scale-[0.99]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#141414] text-white transition-transform duration-300 group-hover:rotate-90">
                <Ico className="h-3.5 w-3.5" d={<path d="M12 5v14M5 12h14" />} />
              </span>
              {p.extras.length ? "Добавить ещё доступ" : "Добавить доступ"}
            </button>
          ) : (
            <p className="text-sm text-black/45">Можно добавить до {MAX_EXTRAS} доступов. Остальные передайте по новой ссылке — попросите менеджера.</p>
          )}
        </div>
      </Step>

      <Step n={num()} title="Комментарий" hint="Необязательно. Например, кто у вас отвечает за этот сервис.">
        <textarea
          aria-label="Комментарий"
          className={`${inputCls(!!errors.comment)} min-h-[96px] resize-y`}
          value={p.comment}
          onChange={(e) => set("comment", e.target.value)}
          maxLength={2000}
        />
        {errors.comment && <p className="mt-2 text-xs font-medium" style={{ color: RED }}>{errors.comment}</p>}
      </Step>

      <motion.div
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }}
        className="border-t border-black/10 pt-6 sm:pl-[80px]"
      >
        {err && <p className="mb-4 text-sm font-medium" style={{ color: RED }}>{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="group flex w-full items-center justify-between gap-3 rounded-2xl px-6 py-4 text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(230,0,0,0.55)] transition duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-[#c40000] active:scale-[0.98] disabled:opacity-70 sm:w-auto sm:min-w-[320px]"
          style={{ background: busy ? "#c40000" : RED }}
        >
          <span className="flex items-center gap-2.5">
            <LockIco className={`h-[18px] w-[18px] ${busy && !reduce ? "animate-pulse" : ""}`} />
            {busy ? "Шифруем и отправляем…" : "Зашифровать и отправить"}
          </span>
          {!busy && <ArrowIco className="h-[18px] w-[18px] transition-transform duration-300 group-hover:translate-x-1" />}
        </button>
        <p className="mt-3 text-xs text-black/45">Отправить можно один раз. После отправки ссылка перестанет работать.</p>
        <p className="mt-6 text-xs leading-relaxed text-black/40 md:hidden">
          Данные шифруются в вашем браузере, открыть их может только KO Agency. Мы никогда не просим присылать коды из SMS в чат.
        </p>
      </motion.div>
    </motion.form>
  );
}
