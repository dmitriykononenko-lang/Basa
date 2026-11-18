/** @type {import('next').NextConfig} */

// Страница клиента «Передача доступа» (/a): никаких сторонних скриптов и запросов —
// шифрование идёт в браузере, и чужой код на странице мог бы прочитать данные до него.
const isDev = process.env.NODE_ENV !== "production";
const intakeCsp = [
  "default-src 'self'",
  // App Router встраивает inline-скрипты без nonce; внешних источников нет.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const intakeHeaders = [
  { key: "Content-Security-Policy", value: intakeCsp },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Cache-Control", value: "no-store" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/a", headers: intakeHeaders },
      { source: "/api/intake/:path*", headers: intakeHeaders },
    ];
  },
};

module.exports = nextConfig;
