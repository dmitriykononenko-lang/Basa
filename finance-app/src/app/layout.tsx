import type { Metadata } from "next";
import localFont from "next/font/local";
import { Manrope } from "next/font/google";
import "./globals.css";

// General Sans — self-hosted (шрифт из дизайн-макета), веса 300–700.
// В нём нет кириллицы, поэтому это латиница/цифры/символы; кириллицу закрывает Manrope.
const generalSans = localFont({
  src: [
    { path: "./fonts/general-sans-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/general-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/general-sans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/general-sans-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/general-sans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

// Manrope — покрывает кириллицу (браузер подставит его для глифов, которых нет в General Sans).
const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans-cyr",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Basa Finance — учёт финансов команды",
  description:
    "Доходы и расходы, долги, бюджеты и аналитика для команды в одном сервисе.",
};

// База Supabase в eu-central-1 (Франкфурт). Рендерим серверные функции рядом,
// чтобы убрать трансатлантическую задержку (~100 мс) на каждый запрос к БД.
export const preferredRegion = "fra1";

// Ставим тему до отрисовки, чтобы не было мигания
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${generalSans.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
