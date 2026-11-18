// Локальный стенд: узкая замена PostgREST только для публичных RPC страницы клиента.
// supabase-js → POST /rest/v1/rpc/<fn> → psql (роль anon) → настоящие SQL-функции
// в локальной БД. Production не используется. Только для проверки фичи локально.
//
//   node scripts/local-stack/rpc-gateway.mjs   (порт 54321, БД basa_local на 54329)
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const PGPORT = process.env.PGPORT ?? "54329";
const DB = process.env.DB ?? "basa_local";

// Разрешены только публичные функции и их аргументы — ровно как у anon в production.
const ALLOWED = {
  vault_intake_load: ["_token", "_client"],
  vault_intake_submit: ["_token", "_payload", "_user_added", "_fallback", "_client"],
};
const CASTS = { _token: "text", _payload: "text", _client: "jsonb", _user_added: "boolean", _fallback: "boolean" };

function callAsAnon(fn, args) {
  const names = ALLOWED[fn];
  const vars = [];
  const params = names.map((n, i) => {
    const v = args[n];
    const s = v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    vars.push("-v", `a${i}=${s}`);
    return `${n} => nullif(:'a${i}', '')::${CASTS[n]}`;
  });
  const sql =
    `begin;\nset local role anon;\nset local request.jwt.claims = '{"role":"anon"}';\n` +
    `select public.${fn}(${params.join(", ")})::text;\ncommit;\n`;
  return new Promise((resolve) => {
    const p = spawn("psql", ["-h", "127.0.0.1", "-p", PGPORT, "-U", "postgres", "-d", DB, "-qtA", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", ...vars]);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out: out.split("\n").filter((l) => l && l !== "SET").join("\n"), err }));
    p.stdin.end(sql);
  });
}

http
  .createServer(async (req, res) => {
    const m = req.url?.match(/^\/rest\/v1\/rpc\/([a-z_]+)/);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (!m || req.method !== "POST" || !ALLOWED[m[1]]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "not available in local gateway" }));
      }
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { /* пусто */ }
      const r = await callAsAnon(m[1], args);
      if (r.code !== 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: r.err.trim() }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(r.out || "null");
      console.log(new Date().toISOString(), m[1], "→", (JSON.parse(r.out || "null") ?? {}).status);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`rpc-gateway on http://127.0.0.1:${PORT} → ${DB}@${PGPORT}`));
