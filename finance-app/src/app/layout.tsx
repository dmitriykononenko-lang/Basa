import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basa Finance — учёт финансов команды",
  description:
    "Доходы и расходы, долги, бюджеты и аналитика для команды в одном сервисе.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
