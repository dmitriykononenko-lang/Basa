"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/authErrors";
import Brand from "@/components/Brand";
import { SignInPage, type Testimonial } from "@/components/ui/sign-in";

type Mode = "signin" | "signup";
// Панель «письмо отправлено»: подтверждение почты или сброс пароля
type Sent = { kind: "confirm" | "reset"; email: string };

const HERO = "https://images.unsplash.com/photo-1642615835477-d303d7dc9ee9?w=2160&q=80";

const testimonials: Testimonial[] = [
  {
    avatarSrc: "https://randomuser.me/api/portraits/women/57.jpg",
    name: "Анна Котова",
    handle: "@anna.finance",
    text: "Наконец-то вижу прозрачную картину по деньгам команды — ДДС, фонды и проекты в одном месте.",
  },
  {
    avatarSrc: "https://randomuser.me/api/portraits/men/64.jpg",
    name: "Максим Орлов",
    handle: "@maxorlov",
    text: "Импорт выписок и распределение по статьям сэкономили мне несколько часов в неделю.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signin");
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
  function toggleMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    const fullName = String(fd.get("fullName") || "").trim();

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
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: callbackUrl(next) },
        });
        if (error) throw error;
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setSent({ kind: "confirm", email });
        }
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(email: string) {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError("Введите email в поле выше, чтобы отправить ссылку для сброса пароля.");
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
    const title = sent.kind === "confirm" ? "Подтвердите почту" : "Сброс пароля";
    const desc =
      sent.kind === "confirm"
        ? "Мы отправили письмо со ссылкой подтверждения на"
        : "Мы отправили ссылку для установки нового пароля на";
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="surface w-full max-w-md p-8 text-center">
          <Brand className="mx-auto mb-5 scale-110" />
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-2xl">✉️</div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            {desc} <b className="text-slate-700 dark:text-neutral-200">{sent.email}</b>.
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Не пришло? Проверьте папку «Спам».</p>

          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
          {message && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</p>}

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={resend} disabled={resending} className="btn-primary w-full">
              {resending ? "Отправляем…" : "Отправить письмо ещё раз"}
            </button>
            <button onClick={() => setSent(null)} className="text-sm text-slate-500 hover:text-slate-700 dark:text-neutral-400">
              ← Назад ко входу
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <SignInPage
      logo={<Brand className="scale-110" />}
      title={
        <span className="font-light tracking-tighter text-foreground">
          {mode === "signin" ? "С возвращением" : "Создать аккаунт"}
        </span>
      }
      description={
        mode === "signin"
          ? "Войдите в аккаунт, чтобы продолжить работу с финансами команды"
          : "Зарегистрируйтесь, чтобы вести учёт финансов команды"
      }
      heroImageSrc={HERO}
      testimonials={testimonials}
      mode={mode}
      error={error}
      notice={message}
      loading={loading}
      googleLoading={oauthLoading}
      onSignIn={handleSubmit}
      onGoogleSignIn={handleGoogle}
      onResetPassword={handleForgot}
      onToggleMode={toggleMode}
    />
  );
}
