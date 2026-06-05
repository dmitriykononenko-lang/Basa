import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/auth");

  // Неавторизованных уводим на /login, сохраняя адрес назначения в ?next
  if (!user && !isAuthRoute) {
    const nextPath = request.nextUrl.pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (nextPath && nextPath !== "/") url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url);
  }

  // Авторизованных со страницы логина — на next или дашборд
  if (user && path.startsWith("/login")) {
    const next = request.nextUrl.searchParams.get("next");
    const url = request.nextUrl.clone();
    url.search = "";
    url.pathname = next && next.startsWith("/") ? next.split("?")[0] : "/dashboard";
    if (next && next.includes("?")) url.search = "?" + next.split("?")[1];
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
