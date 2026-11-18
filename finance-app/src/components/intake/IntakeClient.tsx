"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sealForTeam } from "@/lib/intake-crypto";
import {
  accountFieldLabel, cleanPayload, emptyPayload, isUserAddService, serviceTitle, validatePayload,
  TWOFA_METHODS, type IntakePayload, type IntakeServiceKind, type TwoFaMethod,
} from "@/lib/intake-form";

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

type Phase =
  | { k: "loading" }
  | { k: "closed"; reason: "invalid" | "expired" | "used" | "revoked" | "nolink" | "error" }
  | { k: "form"; data: Loaded }
  | { k: "done"; userMode: boolean };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const STORE_KEY = "ko-intake-token";

const CLOSED_TEXT: Record<string, { title: string; body: string }> = {
  invalid: { title: "Ссылка не найдена", body: "Проверьте, что открыли ссылку полностью, или попросите менеджера KO Agency прислать новую." },
  nolink: { title: "Откройте ссылку из сообщения", body: "Страница открывается только по персональной ссылке от менеджера KO Agency." },
  expired: { title: "Срок ссылки истёк", body: "Ссылка действует 48 часов. Попросите менеджера KO Agency прислать новую." },
  used: { title: "Данные уже переданы", body: "По этой ссылке доступ уже отправлен. Если нужно что-то изменить, напишите менеджеру — он пришлёт новую ссылку." },
  revoked: { title: "Ссылка отозвана", body: "Менеджер KO Agency закрыл эту ссылку. Если доступ всё ещё нужно передать, попросите новую." },
  error: { title: "Не удалось открыть страницу", body: "Обновите страницу через минуту. Если не помогло — напишите менеджеру KO Agency." },
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
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
      window.history.replaceState(null, "", window.location.pathname);
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

  return (
    <div className="min-h-screen bg-[#f2f2f2] text-[#101010]">
      <header className="bg-black">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ko-agency-wordmark.svg" alt="KO Agency" className="h-5 w-auto sm:h-6" />
          <span className="text-xs text-[#7a8ca7]">Защищённая передача доступа</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        {phase.k === "loading" && <p className="text-sm text-neutral-500">Открываем…</p>}
        {phase.k === "closed" && <Closed reason={phase.reason} />}
        {phase.k === "form" && (
          <IntakeForm
            data={phase.data}
            token={token}
            onDone={(userMode) => {
              try { sessionStorage.removeItem(STORE_KEY); } catch {}
              setPhase({ k: "done", userMode });
            }}
            onClosed={(reason) => setPhase({ k: "closed", reason })}
          />
        )}
        {phase.k === "done" && (
          <Card>
            <h1 className="text-xl font-bold">Готово, спасибо!</h1>
            <p className="mt-2 text-sm text-neutral-600">
              {phase.userMode
                ? "Мы получили отметку, что вы добавили нас. Менеджер KO Agency проверит доступ и напишет вам."
                : "Данные зашифрованы и переданы в парольницу KO Agency. Ссылка больше не действует."}
            </p>
            <p className="mt-4 text-xs text-neutral-500">Страницу можно закрыть.</p>
          </Card>
        )}
        <SafetyNote />
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#dddddd] bg-white p-5 sm:p-7">{children}</section>;
}

function Closed({ reason }: { reason: string }) {
  const t = CLOSED_TEXT[reason] ?? CLOSED_TEXT.error;
  return (
    <Card>
      <h1 className="text-xl font-bold">{t.title}</h1>
      <p className="mt-2 text-sm text-neutral-600">{t.body}</p>
    </Card>
  );
}

function SafetyNote() {
  return (
    <div className="mt-6 space-y-1.5 text-xs leading-relaxed text-neutral-500">
      <p>
        <b className="text-neutral-700">Как мы защищаем данные.</b> Всё, что вы вводите, шифруется прямо в вашем браузере.
        На сервер уходит только зашифрованный текст, прочитать его может только KO Agency в своей парольнице.
      </p>
      <p>
        Адрес этой страницы всегда <b className="text-neutral-700">access.koagency.me</b>. Мы никогда не просим присылать
        коды из SMS в чат и не спрашиваем пароли от вашей почты или Telegram.
      </p>
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-neutral-800">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-[#e60000]">{error}</span>}
    </label>
  );
}

const inputCls =
  "mt-1 block w-full rounded-xl border border-[#dddddd] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-black";

function Instructions({ kind, agency }: { kind: IntakeServiceKind; agency: Loaded["agency"] }) {
  const email = <b className="select-all font-semibold text-black">{agency.email}</b>;
  const steps: React.ReactNode[] = [];
  if (kind === "amocrm" || kind === "kommo") {
    const name = kind === "amocrm" ? "amoCRM" : "Kommo";
    steps.push(<>Войдите в {name} под администратором аккаунта.</>);
    steps.push(<>Откройте <b>Настройки → Пользователи</b> и нажмите <b>«Добавить пользователя»</b>.</>);
    steps.push(<>Укажите email {email} и включите права <b>«Администратор»</b>.</>);
    steps.push(<>Сохраните. Если в тарифе нет свободного места, отметьте это в комментарии — подскажем, как лучше.</>);
  } else if (kind === "meta") {
    if (agency.metaBusinessId) {
      steps.push(<>Откройте <b>business.facebook.com → Настройки компании → Пользователи → Партнёры</b>.</>);
      steps.push(<>Нажмите <b>«Добавить» → «Предоставить партнёру доступ к своим ресурсам»</b> и введите ID бизнес-портфолио KO Agency: <b className="select-all text-black">{agency.metaBusinessId}</b>.</>);
      steps.push(<>Отметьте нужные ресурсы (рекламный аккаунт, страница, пиксель) и выдайте полный доступ.</>);
    } else {
      steps.push(<>Откройте <b>business.facebook.com → Настройки компании → Пользователи → Люди</b>.</>);
      steps.push(<>Нажмите <b>«Пригласить»</b>, укажите email {email} и выберите полный доступ.</>);
      steps.push(<>Назначьте доступ к нужным ресурсам: рекламный аккаунт, страница, пиксель.</>);
    }
  } else if (kind === "google_ads") {
    steps.push(<>Откройте <b>ads.google.com → Администратор → Доступ и безопасность</b>.</>);
    steps.push(<>Нажмите <b>«+»</b>, укажите email {email} и уровень доступа <b>«Администратор»</b>.</>);
    steps.push(<>Нажмите <b>«Отправить приглашение»</b>.</>);
    if (agency.googleManagerId) {
      steps.push(<>Или примите запрос на привязку к управляющему аккаунту KO Agency <b className="select-all text-black">{agency.googleManagerId}</b>.</>);
    }
  }
  return (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-neutral-700">
      {steps.map((s, i) => <li key={i}>{s}</li>)}
    </ol>
  );
}

function IntakeForm({
  data, token, onDone, onClosed,
}: {
  data: Loaded;
  token: string;
  onDone: (userMode: boolean) => void;
  onClosed: (reason: "invalid" | "expired" | "used" | "revoked" | "error") => void;
}) {
  const kind = data.service_kind;
  const userAdd = isUserAddService(kind);
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
  const title = serviceTitle(kind, data.service_label);
  const passwordMode = !userAdd || p.fallback;
  const needWhere = useMemo(() => ["sms", "email", "telegram", "other"].includes(p.twofa_method), [p.twofa_method]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const clean = cleanPayload(p);
    const v = validatePayload(clean);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const sealed = await sealForTeam(data.public_key, data.key_id, data.request_id, clean);
      const res = await fetch("/api/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, payload: sealed, user_added: clean.user_added, fallback: clean.fallback }),
        cache: "no-store",
      });
      const d = await res.json().catch(() => ({}));
      if (d?.status === "ok") onDone(userAdd && !clean.fallback);
      else if (["invalid", "expired", "used", "revoked"].includes(d?.status)) onClosed(d.status);
      else setErr("Не удалось отправить. Попробуйте ещё раз через минуту.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Не удалось зашифровать данные.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" autoComplete="off" noValidate>
      <Card>
        <p className="text-xs uppercase tracking-wide text-neutral-500">Запрос доступа</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          {data.client_name && (<><dt className="text-neutral-500">Компания</dt><dd className="font-medium">{data.client_name}</dd></>)}
          <dt className="text-neutral-500">Запросил</dt><dd className="font-medium">{data.requester_name}, KO Agency</dd>
          <dt className="text-neutral-500">Действует до</dt><dd className="font-medium">{fmtDate(data.expires_at)}</dd>
        </dl>
      </Card>

      {userAdd && (
        <Card>
          <h2 className="text-base font-semibold">Добавьте нас пользователем — так пароль передавать не нужно</h2>
          <Instructions kind={kind} agency={data.agency} />
          {!p.fallback && (
            <div className="mt-5 space-y-4">
              <Field label={accountFieldLabel(kind)} error={errors.account}>
                <input className={inputCls} value={p.account} onChange={(e) => set("account", e.target.value)} maxLength={200} />
              </Field>
              <label className="flex items-start gap-3 rounded-xl bg-[#f2f2f2] p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#e60000]" checked={p.user_added} onChange={(e) => set("user_added", e.target.checked)} />
                <span>Я добавил(а) KO Agency{kind === "meta" && data.agency.metaBusinessId ? " партнёром" : " пользователем"}</span>
              </label>
              {errors.user_added && <p className="text-xs font-medium text-[#e60000]">{errors.user_added}</p>}
            </div>
          )}
          <button
            type="button"
            className="mt-4 text-xs text-neutral-500 underline underline-offset-2 hover:text-black"
            onClick={() => { set("fallback", !p.fallback); setErrors({}); }}
          >
            {p.fallback ? "Вернуться к добавлению пользователя" : "Не получается добавить — передать логин и пароль"}
          </button>
        </Card>
      )}

      {passwordMode && (
        <Card>
          <h2 className="text-base font-semibold">{userAdd ? "Логин и пароль" : "Данные для входа"}</h2>
          <div className="mt-4 space-y-4">
            {kind === "other" && (
              <Field label="Сервис" error={errors.service_name}>
                <input className={inputCls} value={p.service_name} onChange={(e) => set("service_name", e.target.value)} maxLength={200} />
              </Field>
            )}
            {(kind === "other" || p.fallback) && (
              <Field label={kind === "other" ? "Адрес входа" : accountFieldLabel(kind)} hint={kind === "other" ? "Ссылка на страницу входа, если есть" : undefined} error={kind === "other" ? errors.url : errors.account}>
                <input
                  className={inputCls}
                  value={kind === "other" ? p.url : p.account}
                  onChange={(e) => (kind === "other" ? set("url", e.target.value) : set("account", e.target.value))}
                  maxLength={200}
                />
              </Field>
            )}
            <Field label="Логин" error={errors.login}>
              <input className={inputCls} value={p.login} onChange={(e) => set("login", e.target.value)} maxLength={200} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Пароль" error={errors.password}>
              <div className="relative">
                <input
                  className={`${inputCls} pr-24`}
                  type={showPw ? "text" : "password"}
                  value={p.password}
                  onChange={(e) => set("password", e.target.value)}
                  maxLength={500}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-neutral-500 hover:text-black">
                  {showPw ? "Скрыть" : "Показать"}
                </button>
              </div>
            </Field>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-base font-semibold">Куда приходит код подтверждения (2FA)</h2>
        <p className="mt-1 text-xs text-neutral-500">Сами коды и резервные коды не присылайте — при входе мы свяжемся с вами заранее.</p>
        <div className="mt-4 space-y-4">
          <Field label="Способ">
            <select className={inputCls} value={p.twofa_method} onChange={(e) => set("twofa_method", e.target.value as TwoFaMethod)}>
              {TWOFA_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          {(needWhere || p.twofa_method === "app") && (
            <Field label="Куда приходит и кто может продиктовать код" hint="Например: SMS на номер …-12, Анна, офис-менеджер" error={errors.twofa_where}>
              <input className={inputCls} value={p.twofa_where} onChange={(e) => set("twofa_where", e.target.value)} maxLength={200} />
            </Field>
          )}
        </div>
      </Card>

      <Card>
        <Field label="Комментарий (необязательно)" error={errors.comment}>
          <textarea className={`${inputCls} min-h-[80px]`} value={p.comment} onChange={(e) => set("comment", e.target.value)} maxLength={2000} />
        </Field>
        {err && <p className="mt-3 text-sm font-medium text-[#e60000]">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-[#e60000] px-5 py-3 text-[15px] font-semibold text-white transition hover:bg-[#990000] disabled:opacity-60"
        >
          {busy ? "Шифруем и отправляем…" : "Зашифровать и отправить"}
        </button>
        <p className="mt-2 text-center text-xs text-neutral-500">Отправить можно один раз. После отправки ссылка перестанет работать.</p>
      </Card>
    </form>
  );
}
