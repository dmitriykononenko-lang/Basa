export default function Loading() {
  return (
    <div className="animate-pulse p-6 sm:p-8">
      <div className="mb-7 h-9 w-56 rounded-2xl bg-slate-200 dark:bg-neutral-800" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 rounded-3xl bg-slate-100 ring-1 ring-slate-200/60 dark:bg-neutral-900 dark:ring-neutral-800"
          />
        ))}
      </div>
      <div className="mt-6 h-64 rounded-3xl bg-slate-100 ring-1 ring-slate-200/60 dark:bg-neutral-900 dark:ring-neutral-800" />
    </div>
  );
}
