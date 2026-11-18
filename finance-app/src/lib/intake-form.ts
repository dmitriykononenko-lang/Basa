// «Запросить доступ у клиента»: сервисы, проверка формы клиента и сборка
// записи парольницы из расшифрованных данных. Без зависимостей — используется
// и в браузере, и в тестах.

export type IntakeServiceKind = "amocrm" | "kommo" | "meta" | "google_ads" | "other";

export const INTAKE_SERVICES: { kind: IntakeServiceKind; label: string; userAdd: boolean }[] = [
  { kind: "amocrm", label: "amoCRM", userAdd: true },
  { kind: "kommo", label: "Kommo", userAdd: true },
  { kind: "meta", label: "Meta (Business Manager)", userAdd: true },
  { kind: "google_ads", label: "Google Ads", userAdd: true },
  { kind: "other", label: "Другой сервис (логин и пароль)", userAdd: false },
];

export function serviceTitle(kind: IntakeServiceKind, label?: string | null): string {
  const l = (label ?? "").trim();
  if (l) return l;
  switch (kind) {
    case "amocrm": return "amoCRM";
    case "kommo": return "Kommo";
    case "meta": return "Meta Business";
    case "google_ads": return "Google Ads";
    default: return "Сервис";
  }
}

// Сервисы, где мы просим «добавьте нас пользователем/партнёром», а пароль —
// только запасной вариант.
export function isUserAddService(kind: IntakeServiceKind): boolean {
  return kind !== "other";
}

export type TwoFaMethod = "none" | "sms" | "app" | "email" | "telegram" | "other" | "unknown";

export const TWOFA_METHODS: { value: TwoFaMethod; label: string }[] = [
  { value: "unknown", label: "Не знаю" },
  { value: "none", label: "Двухфакторной защиты нет" },
  { value: "sms", label: "SMS на телефон" },
  { value: "app", label: "Приложение-аутентификатор" },
  { value: "email", label: "Письмо на почту" },
  { value: "telegram", label: "Telegram" },
  { value: "other", label: "Другое" },
];

// То, что шифруется в браузере клиента. Сервер этого объекта не видит.
export type IntakePayload = {
  service: IntakeServiceKind;
  service_name: string;
  account: string;   // адрес аккаунта / ID бизнеса / ID рекламного аккаунта
  url: string;
  login: string;
  password: string;
  twofa_method: TwoFaMethod;
  twofa_where: string; // куда приходит код и кто может его продиктовать
  comment: string;
  user_added: boolean;
  fallback: boolean;  // клиент выбрал «передать пароль» вместо добавления пользователя
  extras: IntakeExtra[]; // другие доступы, которые клиент добавил сам (любые сервисы)
};

// Дополнительный доступ, который клиент добавляет сам, помимо запрошенного.
export type IntakeExtra = {
  service_name: string;
  url: string;
  login: string;
  password: string;
  twofa_method: TwoFaMethod;
  twofa_where: string;
  comment: string;
};

export const MAX_EXTRAS = 10;

export function emptyExtra(): IntakeExtra {
  return { service_name: "", url: "", login: "", password: "", twofa_method: "unknown", twofa_where: "", comment: "" };
}

const needsWhere = (m: TwoFaMethod) => m === "sms" || m === "email" || m === "telegram" || m === "other";

export const LIMITS = { short: 200, long: 2000, password: 500 } as const;

export function emptyPayload(kind: IntakeServiceKind, serviceName = ""): IntakePayload {
  return {
    service: kind, service_name: serviceName, account: "", url: "", login: "", password: "",
    twofa_method: "unknown", twofa_where: "", comment: "", user_added: false, fallback: false, extras: [],
  };
}

export function accountFieldLabel(kind: IntakeServiceKind): string {
  switch (kind) {
    case "amocrm": return "Адрес вашего аккаунта (например, company.amocrm.ru)";
    case "kommo": return "Адрес вашего аккаунта (например, company.kommo.com)";
    case "meta": return "ID вашего бизнес-портфолио (Business ID)";
    case "google_ads": return "ID рекламного аккаунта (xxx-xxx-xxxx)";
    default: return "Адрес входа (ссылка на страницу логина)";
  }
}

// Нормализация и проверка. Возвращает ошибки по полям (пустой объект — всё верно).
export function validatePayload(p: IntakePayload): Record<string, string> {
  const e: Record<string, string> = {};
  const tooLong = (v: string, n: number) => v.length > n;
  if (tooLong(p.account, LIMITS.short)) e.account = "Слишком длинно";
  if (tooLong(p.url, LIMITS.short)) e.url = "Слишком длинно";
  if (tooLong(p.login, LIMITS.short)) e.login = "Слишком длинно";
  if (tooLong(p.password, LIMITS.password)) e.password = "Слишком длинно";
  if (tooLong(p.twofa_where, LIMITS.short)) e.twofa_where = "Слишком длинно";
  if (tooLong(p.comment, LIMITS.long)) e.comment = "Слишком длинно";
  if (tooLong(p.service_name, LIMITS.short)) e.service_name = "Слишком длинно";

  if (isUserAddService(p.service) && !p.fallback) {
    if (!p.user_added) e.user_added = "Отметьте, что добавили нас, или выберите передачу пароля";
    if (!p.account.trim()) e.account = "Укажите, к какому аккаунту выдан доступ";
  } else {
    if (p.service === "other" && !p.service_name.trim()) e.service_name = "Укажите сервис";
    if (!p.login.trim()) e.login = "Укажите логин";
    if (!p.password) e.password = "Укажите пароль";
  }
  if (needsWhere(p.twofa_method) && !p.twofa_where.trim()) {
    e.twofa_where = "Укажите, куда приходит код и кто может его продиктовать";
  }
  if ((p.extras ?? []).length > MAX_EXTRAS) e.extras = `Не больше ${MAX_EXTRAS} дополнительных доступов`;
  (p.extras ?? []).forEach((x, i) => {
    const k = (f: string) => `extras.${i}.${f}`;
    if (!x.service_name.trim()) e[k("service_name")] = "Укажите сервис";
    else if (x.service_name.length > LIMITS.short) e[k("service_name")] = "Слишком длинно";
    if (!x.login.trim()) e[k("login")] = "Укажите логин";
    else if (x.login.length > LIMITS.short) e[k("login")] = "Слишком длинно";
    if (!x.password) e[k("password")] = "Укажите пароль";
    else if (x.password.length > LIMITS.password) e[k("password")] = "Слишком длинно";
    if (x.url.length > LIMITS.short) e[k("url")] = "Слишком длинно";
    if (x.comment.length > LIMITS.long) e[k("comment")] = "Слишком длинно";
    if (needsWhere(x.twofa_method) && !x.twofa_where.trim()) e[k("twofa_where")] = "Укажите, куда приходит код";
    else if (x.twofa_where.length > LIMITS.short) e[k("twofa_where")] = "Слишком длинно";
  });
  return e;
}

export function cleanPayload(p: IntakePayload): IntakePayload {
  const t = (v: string) => v.replace(/\u0000/g, "").trim();
  const passwordProvided = p.fallback || !isUserAddService(p.service);
  return {
    service: p.service,
    service_name: t(p.service_name),
    account: t(p.account),
    url: t(p.url),
    login: passwordProvided ? t(p.login) : "",
    password: passwordProvided ? p.password.replace(/\u0000/g, "") : "",
    twofa_method: p.twofa_method,
    twofa_where: t(p.twofa_where),
    comment: t(p.comment),
    user_added: isUserAddService(p.service) && !p.fallback ? p.user_added : false,
    fallback: isUserAddService(p.service) ? p.fallback : false,
    extras: (p.extras ?? []).slice(0, MAX_EXTRAS).map((x) => ({
      service_name: t(x.service_name),
      url: t(x.url),
      login: t(x.login),
      password: x.password.replace(/\u0000/g, ""),
      twofa_method: x.twofa_method,
      twofa_where: t(x.twofa_where),
      comment: t(x.comment),
    })),
  };
}

const twofaLabel = (m: TwoFaMethod) => TWOFA_METHODS.find((x) => x.value === m)?.label ?? "Не знаю";

const loginUrlFor = (kind: IntakeServiceKind, account: string): string => {
  const a = account.trim();
  if (!a) return "";
  if (kind === "amocrm" || kind === "kommo") {
    const host = a.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : "";
  }
  if (kind === "meta") return "https://business.facebook.com/";
  if (kind === "google_ads") return "https://ads.google.com/";
  return "";
};

// Черновик записи парольницы из расшифрованных данных (владелец может поправить
// перед сохранением).
export function draftEntry(
  p: IntakePayload,
  ctx: { serviceLabel?: string; clientName?: string; agencyEmail?: string; submittedAt?: string },
): { title: string; login: string; url: string; note: string; secret: string; group: string } {
  const service = p.service === "other" ? (p.service_name || serviceTitle("other", ctx.serviceLabel)) : serviceTitle(p.service, ctx.serviceLabel);
  const client = (ctx.clientName ?? "").trim();
  const title = client ? `${service} · ${client}` : service;
  const userMode = isUserAddService(p.service) && !p.fallback;

  const lines: string[] = [];
  if (userMode) {
    lines.push(`Клиент добавил нас пользователем${ctx.agencyEmail ? ` (${ctx.agencyEmail})` : ""}. Пароль не передавался.`);
  }
  if (p.account) lines.push(`Аккаунт: ${p.account}`);
  if (p.fallback) lines.push("Клиент передал логин и пароль вместо добавления пользователя.");
  lines.push(`2FA: ${twofaLabel(p.twofa_method)}${p.twofa_where ? ` — ${p.twofa_where}` : ""}`);
  if (p.comment) lines.push(`Комментарий клиента: ${p.comment}`);
  lines.push(`Передано клиентом по защищённой ссылке${ctx.submittedAt ? ` ${ctx.submittedAt}` : ""}.`);

  return {
    title,
    login: userMode ? (ctx.agencyEmail ?? "") : p.login,
    url: p.url || loginUrlFor(p.service, p.account),
    note: lines.join("\n"),
    secret: userMode ? "" : p.password,
    group: "Доступы клиентов",
  };
}

// Черновики записей для дополнительных доступов клиента.
export function draftExtras(
  p: IntakePayload,
  ctx: { clientName?: string; submittedAt?: string },
): { title: string; login: string; url: string; note: string; secret: string; group: string }[] {
  const client = (ctx.clientName ?? "").trim();
  return (p.extras ?? []).map((x) => {
    const lines = [`2FA: ${twofaLabel(x.twofa_method)}${x.twofa_where ? ` — ${x.twofa_where}` : ""}`];
    if (x.comment) lines.push(`Комментарий клиента: ${x.comment}`);
    lines.push(`Клиент добавил этот доступ сам при передаче по защищённой ссылке${ctx.submittedAt ? ` ${ctx.submittedAt}` : ""}.`);
    return {
      title: client ? `${x.service_name} · ${client}` : x.service_name,
      login: x.login,
      url: x.url,
      note: lines.join("\n"),
      secret: x.password,
      group: "Доступы клиентов",
    };
  });
}

// Что передано — для квитанции клиенту (без значений логинов и паролей).
export function receiptLines(p: IntakePayload, serviceLabel?: string): { title: string; detail: string }[] {
  const main = p.service === "other" ? (p.service_name || serviceTitle("other", serviceLabel)) : serviceTitle(p.service, serviceLabel);
  const userMode = isUserAddService(p.service) && !p.fallback;
  const tf = (m: TwoFaMethod) => (m === "unknown" ? "" : ` · 2FA: ${twofaLabel(m).toLowerCase()}`);
  const out = [{ title: main, detail: (userMode ? "добавили нас пользователем, пароль не передавался" : "логин и пароль") + tf(p.twofa_method) }];
  for (const x of p.extras ?? []) out.push({ title: x.service_name, detail: "логин и пароль" + tf(x.twofa_method) });
  return out;
}
