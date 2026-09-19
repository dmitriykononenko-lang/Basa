"use client";

// Граница ошибок Mini App: вместо пустого экрана показываем сообщение и кнопку
// перезагрузки, если клиентский код упал.
export default function TgError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <h1 className="text-lg font-bold">Не удалось открыть обучение</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
        Что-то пошло не так при загрузке. Попробуйте ещё раз.
      </p>
      <button type="button" onClick={reset} className="btn-primary mt-4">
        Перезагрузить
      </button>
    </div>
  );
}
