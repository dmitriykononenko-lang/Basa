// Перевод сообщений Supabase Auth на понятный русский.
// Supabase возвращает технические тексты на английском — маппим частые случаи.
export function authErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const s = raw.toLowerCase();

  if (s.includes("invalid login credentials")) return "Неверный email или пароль.";
  if (s.includes("email not confirmed"))
    return "Email не подтверждён. Проверьте почту или запросите письмо повторно.";
  if (s.includes("already registered") || s.includes("already been registered"))
    return "Пользователь с таким email уже зарегистрирован. Войдите или восстановите пароль.";
  if (s.includes("password should be at least")) {
    const m = raw.match(/at least (\d+)/i);
    return `Пароль должен быть не короче ${m?.[1] ?? 6} символов.`;
  }
  if (s.includes("new password should be different"))
    return "Новый пароль должен отличаться от прежнего.";
  if (s.includes("unable to validate email address") || s.includes("invalid email"))
    return "Некорректный email.";
  if (
    s.includes("for security purposes") ||
    s.includes("rate limit") ||
    s.includes("too many requests") ||
    s.includes("email rate limit") ||
    s.includes("only request this after")
  )
    return "Слишком много попыток. Подождите немного и попробуйте снова.";
  if (s.includes("otp_expired") || s.includes("token has expired") || s.includes("expired"))
    return "Ссылка устарела. Запросите новую.";
  if (
    s.includes("email link is invalid") ||
    s.includes("invalid flow state") ||
    s.includes("code verifier") ||
    s.includes("flow state")
  )
    return "Ссылка недействительна или уже использована. Запросите новую.";
  if (s.includes("signups not allowed") || s.includes("signup is disabled"))
    return "Регистрация временно отключена.";
  if (s.includes("user not found")) return "Пользователь не найден.";
  if (s.includes("provider is not enabled") || s.includes("unsupported provider"))
    return "Этот способ входа пока не настроен.";
  if (s.includes("network") || s.includes("failed to fetch"))
    return "Ошибка сети. Проверьте соединение и попробуйте снова.";

  return raw || "Произошла ошибка. Попробуйте ещё раз.";
}
