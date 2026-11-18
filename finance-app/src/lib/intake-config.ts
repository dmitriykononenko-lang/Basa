// Настройки страницы «Передача доступа» (только сервер). Все значения — не секреты.
//   INTAKE_BASE_URL         — адрес, с которого клиент открывает ссылку (https://access.koagency.me).
//                             Не задан → origin текущего запроса (локально / превью).
//   INTAKE_HOST             — хост страницы клиента; на нём доступны только /a и /api/intake/*.
//   INTAKE_AGENCY_EMAIL     — email, который клиент добавляет пользователем (amo/Kommo, Google Ads, Meta).
//   INTAKE_META_BUSINESS_ID — ID нашего бизнес-портфолио Meta (для «Добавить партнёра»).
//   INTAKE_GOOGLE_MANAGER_ID — ID нашего управляющего аккаунта Google Ads (MCC), если есть.

export type IntakeAgencyConfig = {
  email: string;
  metaBusinessId: string;
  googleManagerId: string;
};

export function intakeAgencyConfig(): IntakeAgencyConfig {
  return {
    email: (process.env.INTAKE_AGENCY_EMAIL ?? "koagency.me@gmail.com").trim(),
    metaBusinessId: (process.env.INTAKE_META_BUSINESS_ID ?? "").trim(),
    googleManagerId: (process.env.INTAKE_GOOGLE_MANAGER_ID ?? "").trim(),
  };
}

export function intakeLinkBase(requestOrigin: string): string {
  const base = (process.env.INTAKE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return base || requestOrigin.replace(/\/+$/, "");
}

// Токен — во фрагменте (#): он не уходит на сервер, в логи и в Referer.
export function intakeLink(requestOrigin: string, token: string): string {
  return `${intakeLinkBase(requestOrigin)}/a#${token}`;
}

export function intakeHost(): string {
  return (process.env.INTAKE_HOST ?? "").trim().toLowerCase();
}

// Адрес самого Basa (ссылки в уведомлениях ведут сюда, а не на страницу клиента).
export function appBaseUrl(requestOrigin: string): string {
  return ((process.env.NEXT_PUBLIC_SITE_URL ?? "").trim() || requestOrigin).replace(/\/+$/, "");
}
