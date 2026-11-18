"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/authErrors";
import Brand from "@/components/Brand";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // После перехода по ссылке из письма callback обменивает код на сессию.
  // Проверяем, что сессия действительно есть, иначе ссылка устарела.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user);
      setChecking(false);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Пароль должен быть не короче 6 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="surface w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <Brand className="mb-3 scale-125" />
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            Установка нового пароля
          </p>
        </div>

        {checking ? (
          <p className="text-center text-sm text-slate-500 dark:text-neutral-400">Проверяем ссылку…</p>
        ) : done ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            Пароль обновлён. Перенаправляем…
          </p>
        ) : !hasSession ? (
          <div className="space-y-4 text-center">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Ссылка недействительна или устарела. Запросите сброс пароля заново.
            </p>
            <a href="/login" className="btn-primary inline-block">
              Ко входу
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                Новый пароль
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                Повторите пароль
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Сохраняем…" : "Сохранить новый пароль"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
