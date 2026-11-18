import Link from "next/link";

/** Окно номеров страниц с многоточиями: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const push = (n: number) => out.push(n);
  const around = new Set<number>([1, total, page - 1, page, page + 1]);
  let prev = 0;
  for (let i = 1; i <= total; i++) {
    if (around.has(i) || (i >= page - 1 && i <= page + 1)) {
      if (prev && i - prev > 1) out.push("…");
      push(i);
      prev = i;
    }
  }
  return out;
}

function Cell({
  children,
  href,
  active,
  disabled,
}: {
  children: React.ReactNode;
  href?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const base =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-3 text-sm font-medium transition";
  if (disabled || !href) {
    return (
      <span className={`${base} cursor-not-allowed text-slate-300 dark:text-neutral-600`}>{children}</span>
    );
  }
  const cls = active
    ? `${base} bg-brand text-white shadow-sm`
    : `${base} text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5`;
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cls}>
      {children}
    </Link>
  );
}

export function PaginationNav({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);
  return (
    <nav className="mt-5 flex flex-wrap items-center justify-center gap-1.5" aria-label="Постраничная навигация">
      <Cell href={page > 1 ? hrefFor(page - 1) : undefined} disabled={page === 1}>
        ← Назад
      </Cell>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1.5 text-slate-400 dark:text-neutral-600">
            …
          </span>
        ) : (
          <Cell key={p} href={hrefFor(p)} active={p === page}>
            {p}
          </Cell>
        ),
      )}
      <Cell href={page < totalPages ? hrefFor(page + 1) : undefined} disabled={page === totalPages}>
        Вперёд →
      </Cell>
    </nav>
  );
}
