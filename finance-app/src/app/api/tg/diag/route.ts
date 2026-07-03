import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Диагностический маяк: вызывается инлайн-скриптом из Mini App как <img>.
// Логирует стадию и user-agent в рантайм-логи Vercel, чтобы понять, доходит ли
// вообще выполнение JS в вебвью Telegram (особенно iOS/WebKit).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") ?? "?";
  const ua = req.headers.get("user-agent") ?? "";
  // eslint-disable-next-line no-console
  console.log(`[tg-diag] stage=${stage} ua=${ua.slice(0, 160)}`);
  // Прозрачный 1x1 GIF, чтобы <img> не показывал «сломанную картинку».
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  return new NextResponse(gif, {
    status: 200,
    headers: { "content-type": "image/gif", "cache-control": "no-store" },
  });
}
