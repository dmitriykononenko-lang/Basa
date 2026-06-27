import { createClient } from "@supabase/supabase-js";

// Серверный клиент с service_role — ТОЛЬКО для серверного кода (route handlers).
// Ключ берётся из переменной окружения SUPABASE_SERVICE_ROLE_KEY.
// Если ключ не задан — возвращаем null (письма не отправляются, работает ссылка).
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
