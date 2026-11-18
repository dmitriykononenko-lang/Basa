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

// Инлайн-маяк: срабатывает сразу при парсинге (без React/гидратации). По нему
// в логах видно, выполняется ли вообще JS в вебвью Telegram на устройстве.
const beacon = `(function(){try{var i=new Image();i.src='/api/tg/diag?stage=inline&t='+Date.now();}catch(e){}})();`;

// Mini App открывается в Telegram-вебвью, вне основного (app)-layout (нет
// сайдбара/сессии). Тему задаёт сама страница по Telegram.WebApp.colorScheme.
export default function TgLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#0f1115] dark:text-white">
      {/* SDK грузим обычным тегом в разметке — доступен максимально рано. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src="https://telegram.org/js/telegram-web-app.js" async />
      <script dangerouslySetInnerHTML={{ __html: beacon }} />
      {children}
    </div>
  );
}
