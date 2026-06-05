export default function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <div className="mt-6 rounded-xl bg-white p-8 text-center ring-1 ring-slate-200">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
          ⏳
        </div>
        <p className="text-sm text-slate-500">{description}</p>
        <p className="mt-1 text-xs text-slate-400">
          Раздел в разработке — появится в ближайших обновлениях.
        </p>
      </div>
    </div>
  );
}
