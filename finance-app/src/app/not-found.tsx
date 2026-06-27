import Link from "next/link";
import Brand from "@/components/Brand";
import { InfiniteRibbon } from "@/components/ui/infinite-ribbon";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Перекрещённые ленты на фоне */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
        <InfiniteRibbon className="absolute -translate-y-6" duration={30} rotation={-5}>
          Страница не найдена · 404 · Похоже, вы свернули не туда ·
        </InfiniteRibbon>
        <InfiniteRibbon className="translate-y-6" duration={30} reverse rotation={5}>
          Вернитесь на дашборд · 404 · Такой страницы нет ·
        </InfiniteRibbon>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 rounded-3xl bg-card/80 px-8 py-10 ring-1 ring-border backdrop-blur-md">
        <Brand className="scale-125" />
        <p className="text-7xl font-extrabold tracking-tight text-slate-900 dark:text-white">404</p>
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Страница не найдена</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Возможно, ссылка устарела или страница была перемещена.
          </p>
        </div>
        <Link href="/dashboard" className="btn-primary">
          На дашборд
        </Link>
      </div>
    </main>
  );
}
