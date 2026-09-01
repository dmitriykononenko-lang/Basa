import Link from "next/link";

export default function EmptyState({
  icon = "✨", title, description, ctaLabel, ctaHref,
}: {
  icon?: string;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl bg-white px-6 py-14 text-center ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-2xl">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-800 dark:text-neutral-100">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-neutral-400">{description}</p>
      )}
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="btn-primary mt-5">{ctaLabel}</Link>
      )}
    </div>
  );
}
