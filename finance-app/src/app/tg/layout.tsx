import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Basa — Обучение",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Mini App открывается в Telegram-вебвью, вне основного (app)-layout (нет
// сайдбара/сессии). Здесь — только контейнер; тему задаёт сама страница по
// Telegram.WebApp.colorScheme.
export default function TgLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white text-slate-900 dark:bg-[#0f1115] dark:text-white">{children}</div>;
}
