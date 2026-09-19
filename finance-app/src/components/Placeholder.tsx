export default function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 sm:p-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        {title}
      </h1>
      <div className="mt-6 rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-2xl text-accent">
          ⏳
        </div>
        <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-neutral-400">
          {description}
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-neutral-600">
          Раздел в разработке — появится в ближайших обновлениях.
        </p>
      </div>
    </div>
  );
}
