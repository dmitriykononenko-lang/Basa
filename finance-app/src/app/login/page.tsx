"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/authErrors";
import Brand from "@/components/Brand";

type Mode = "signin" | "signup" | "magic";
// Панель «письмо отправлено»: подтверждение почты, magic-link или сброс пароля
type Sent = { kind: "confirm" | "magic" | "reset"; email: string };

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  function nextPath() {
    return new URLSearchParams(window.location.search).get("next") || "/dashboard";
  }
  function callbackUrl(next: string) {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setMessage(null);
    setSent(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const next = nextPath();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: callbackUrl(next),
          },
        });
        if (error) throw error;
        // Если включено подтверждение почты — сессии ещё нет
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setSent({ kind: "confirm", email });
        }
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: callbackUrl(next) },
        });
        if (error) throw error;
        setSent({ kind: "magic", email });
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError("Введите email, чтобы отправить ссылку для сброса пароля.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: callbackUrl("/auth/reset"),
      });
      if (error) throw error;
      setSent({ kind: "reset", email });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setOauthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl(nextPath()) },
      });
      if (error) throw error;
      // дальше — редирект на Google
    } catch (err) {
      setError(authErrorMessage(err));
      setOauthLoading(false);
    }
  }

  async function resend() {
    if (!sent) return;
    setResending(true);
    setError(null);
    try {
      if (sent.kind === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(sent.email, {
          redirectTo: callbackUrl("/auth/reset"),
        });
        if (error) throw error;
      } else if (sent.kind === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email: sent.email,
          options: { emailRedirectTo: callbackUrl(nextPath()) },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resend({ type: "signup", email: sent.email });
        if (error) throw error;
      }
      setMessage("Письмо отправлено повторно.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  // ── Экран «проверьте почту» ──
  if (sent) {
    const title =
      sent.kind === "confirm"
        ? "Подтвердите почту"
        : sent.kind === "reset"
          ? "Сброс пароля"
          : "Ссылка для входа отправлена";
    const desc =
      sent.kind === "confirm"
        ? "Мы отправили письмо со ссылкой подтверждения на"
        : sent.kind === "reset"
          ? "Мы отправили ссылку для установки нового пароля на"
          : "Откройте письмо и перейдите по ссылке, чтобы войти. Адрес:";
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="surface w-full max-w-md p-8 text-center">
          <Brand className="mx-auto mb-5 scale-110" />
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-2xl">
            ✉️
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            {desc} <b className="text-slate-700 dark:text-neutral-200">{sent.email}</b>.
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
            Не пришло? Проверьте папку «Спам».
          </p>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
              {error}
            </p>
          )}
          {message && (
            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {message}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={resend} disabled={resending} className="btn-primary w-full">
              {resending ? "Отправляем…" : "Отправить письмо ещё раз"}
            </button>
            <button
              onClick={() => switchMode("signin")}
              className="text-sm text-slate-500 hover:text-slate-700 dark:text-neutral-400"
            >
              ← Назад ко входу
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="surface w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <Brand className="mb-3 scale-125" />
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            Учёт финансов для команды
          </p>
        </div>

        {/* Вход через Google */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={oauthLoading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
        >
          <GoogleIcon className="h-5 w-5" />
          {oauthLoading ? "Перенаправляем…" : "Войти через Google"}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400 dark:text-neutral-500">
          <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
          или по email
          <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
        </div>

        <div className="mb-5 grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {(
            [
              ["signin", "Вход"],
              ["signup", "Регистрация"],
              ["magic", "По ссылке"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-full px-2 py-1.5 font-medium transition ${
                mode === m
                  ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                Имя
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input"
                placeholder="Иван Иванов"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-300">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@company.com"
            />
          </div>

          {mode !== "magic" && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300">
                  Пароль
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={handleForgot}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Забыли пароль?
                  </button>
                )}
              </div>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {message}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading
              ? "Подождите…"
              : mode === "signin"
                ? "Войти"
                : mode === "signup"
                  ? "Создать аккаунт"
                  : "Отправить ссылку"}
          </button>
        </form>
      </div>
    </main>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
