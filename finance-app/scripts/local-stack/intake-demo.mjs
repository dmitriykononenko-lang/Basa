// Локальный проход «Запросить доступ у клиента» со стороны KO (владелец/менеджер).
// Настоящие модули: intake-crypto (WebCrypto), intake-form, vault-crypto (AES-GCM, VAULT_KEY)
// и настоящие SQL-функции в локальной БД. Production не используется.
//
//   node scripts/local-stack/intake-demo.mjs setup [service] [label]  → ключ команды + запрос, печатает ссылку
//   node scripts/local-stack/intake-demo.mjs status                   → статусы запросов и журнал
//   node scripts/local-stack/intake-demo.mjs accept                   → владелец принимает последний отправленный
//
// Пароль ключа команды генерируется случайно и лежит в файле DEMO_SECRET_FILE (не печатается).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateTeamKey, unlockTeamKey, openSealed } from "../../src/lib/intake-crypto.ts";
import { draftEntry, draftExtras, cleanPayload } from "../../src/lib/intake-form.ts";

const PGPORT = process.env.PGPORT ?? "54329";
const DB = process.env.DB ?? "basa_local";
const APP = process.env.APP_URL ?? "http://localhost:3100";
const SECRET_FILE = process.env.DEMO_SECRET_FILE ?? "/tmp/vi_pg/demo-passphrase";
const ENV_FILE = new URL("../../.env.local", import.meta.url);

const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const MANAGER = "aaaaaaaa-0000-4000-8000-000000000002";
const TEAM = "bbbbbbbb-0000-4000-8000-000000000001";
const PROJ = "cccccccc-0000-4000-8000-000000000001";
const CP = "dddddddd-0000-4000-8000-000000000001";

function sql(text, { as, vars = {} } = {}) {
  const v = Object.entries(vars).flatMap(([k, val]) => ["-v", `${k}=${val}`]);
  const pre = as
    ? `begin;\nset local role authenticated;\nset local request.jwt.claims = '{"sub":"${as}","role":"authenticated"}';\n`
    : "begin;\n";
  const r = spawnSync("psql", ["-h", "127.0.0.1", "-p", PGPORT, "-U", "postgres", "-d", DB, "-qtA", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", ...v], {
    input: `${pre}${text}\ncommit;\n`,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.split("\n").filter((l) => l && l !== "SET").join("\n");
}

function vaultKeyFromEnv() {
  const line = readFileSync(ENV_FILE, "utf8").split("\n").find((l) => l.startsWith("VAULT_KEY="));
  if (!line) throw new Error("В .env.local стенда нет VAULT_KEY");
  process.env.VAULT_KEY = line.slice("VAULT_KEY=".length).trim();
}

async function setup(service = "amocrm", label = "") {
  sql(`
insert into auth.users (id, email) values ('${OWNER}','owner@ko.test'),('${MANAGER}','manager@ko.test') on conflict do nothing;
insert into public.profiles (id, full_name) values ('${OWNER}','Дмитрий'),('${MANAGER}','Анна (менеджер KO)')
  on conflict (id) do update set full_name = excluded.full_name;
insert into public.teams (id, name, base_currency, created_by) values ('${TEAM}','KO Agency','RUB','${OWNER}') on conflict do nothing;
insert into public.team_members (team_id, user_id, role) values ('${TEAM}','${OWNER}','owner'),('${TEAM}','${MANAGER}','manager') on conflict do nothing;
insert into public.projects (id, team_id, name) values ('${PROJ}','${TEAM}','Maison · техподдержка') on conflict do nothing;
insert into public.counterparties (id, team_id, name, kind) values ('${CP}','${TEAM}','Maison Bali','client') on conflict do nothing;`);

  const hasKey = sql(`select count(*) from public.vault_team_keys where team_id='${TEAM}' and active;`) !== "0";
  if (!hasKey || !existsSync(SECRET_FILE)) {
    const passphrase = randomBytes(18).toString("base64url");
    writeFileSync(SECRET_FILE, passphrase, { mode: 0o600 });
    const { publicKey, wrapped } = await generateTeamKey(passphrase);
    sql(`select public.vault_team_key_set(:'t', :'p', :'w'::jsonb);`, { as: OWNER, vars: { t: TEAM, p: publicKey, w: JSON.stringify(wrapped) } });
    console.log("ключ команды создан (владелец), пароль ключа — в файле стенда");
  }
  const row = sql(
    `select id || '|' || token || '|' || expires_at from public.vault_intake_create(:'t', :'k', :'l', :'p', :'c', '', 48);`,
    { as: MANAGER, vars: { t: TEAM, k: service, l: label, p: PROJ, c: CP } },
  );
  const [id, token, expires] = row.split("|");
  console.log(`запрос ${id} (${service}) создан менеджером, действует до ${expires}`);
  console.log(`ссылка для клиента: ${APP}/a#${token}`);
}

function status() {
  console.log(sql(`select status, service_kind, client_name, open_count, user_added, fallback_used,
      (payload_cipher is not null) as has_cipher, coalesce(left(payload_cipher, 60), '') as cipher_head
    from public.vault_intake_requests where team_id='${TEAM}' order by created_at;`));
  console.log("--- журнал");
  console.log(sql(`select to_char(created_at,'HH24:MI:SS'), action, coalesce(details->>'service',''), coalesce(details->>'n','')
    from public.vault_access_log where team_id='${TEAM}' order by created_at;`));
  console.log("--- уведомления");
  console.log(sql(`select p.full_name, n.title, n.body, (n.read_at is null) as unread from public.notifications n
    join public.profiles p on p.id = n.user_id where n.team_id='${TEAM}' order by n.created_at;`));
}

async function accept() {
  vaultKeyFromEnv();
  const { encryptSecret, decryptSecret } = await import("../../src/lib/vault-crypto.ts");
  const row = sql(`select r.id || '|' || r.key_id || '|' || r.service_kind || '|' || r.client_name || '|' || to_char(r.submitted_at,'DD.MM HH24:MI')
      from public.vault_intake_requests r where r.team_id='${TEAM}' and r.status='submitted' order by r.submitted_at desc limit 1;`, { as: OWNER });
  if (!row) return console.log("нет отправленных запросов");
  const [id, keyId, , clientName, submittedAt] = row.split("|");
  const cipher = sql(`select payload_cipher from public.vault_intake_requests where id=:'i';`, { as: OWNER, vars: { i: id } });
  const wrapped = JSON.parse(sql(`select wrapped_private_key::text from public.vault_team_keys where id=:'k';`, { as: OWNER, vars: { k: keyId } }));

  const priv = await unlockTeamKey(wrapped, readFileSync(SECRET_FILE, "utf8"));
  const payload = cleanPayload(await openSealed(priv, id, cipher));
  const d = draftEntry(payload, { clientName, agencyEmail: "koagency.me@gmail.com", submittedAt });
  const secretCipher = d.secret ? encryptSecret(d.secret) : "";
  const extras = draftExtras(payload, { clientName, submittedAt });
  const extraJson = JSON.stringify(extras.map((x) => ({ title: x.title, login: x.login, url: x.url, note: x.note, secret_cipher: x.secret ? encryptSecret(x.secret) : "" })));
  const entry = sql(`select public.vault_intake_accept(:'i', :'t', :'l', :'u', :'n', :'s', :'g', :'x'::jsonb);`, {
    as: OWNER, vars: { i: id, t: d.title, l: d.login, u: d.url, n: d.note, s: secretCipher, g: d.group, x: extraJson },
  });
  if (extras.length) {
    console.log(`доп. доступы клиента → ${extras.length} отдельных записей:`);
    for (const x of extras) {
      const ok = sql(`select decrypt_check from (select secret_cipher as decrypt_check from public.vault_entries where title=:'t' order by created_at desc limit 1) q;`, { vars: { t: x.title } });
      console.log(`  ${x.title} | ${x.login} | ${x.url} | пароль совпадает: ${decryptSecret(ok) === x.secret}`);
    }
  }
  console.log(`владелец расшифровал запрос паролем ключа и принял → запись ${entry}`);
  const e = sql(`select title || ' | ' || login || ' | ' || url || ' | проект: ' || coalesce(p.name,'') || ' | клиент: ' || coalesce(c.name,'')
      from public.vault_entries v left join public.projects p on p.id=v.project_id left join public.counterparties c on c.id=v.counterparty_id where v.id=:'e';`, { vars: { e: entry } });
  console.log(`запись: ${e}`);
  console.log(`заметка:\n${d.note}`);
  if (d.secret) {
    const stored = sql(`select secret_cipher from public.vault_entries where id=:'e';`, { vars: { e: entry } });
    console.log(`пароль в записи зашифрован VAULT_KEY; расшифровка совпадает с переданным: ${decryptSecret(stored) === d.secret}`);
  } else {
    console.log("пароль не передавался (клиент добавил нас пользователем)");
  }
  const left = sql(`select (payload_cipher is null)::text || ' ' || status from public.vault_intake_requests where id=:'i';`, { vars: { i: id } });
  console.log(`шифртекст запроса удалён, статус: ${left}`);
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "setup") await setup(a1, a2);
else if (cmd === "status") status();
else if (cmd === "accept") await accept();
else console.log("usage: setup [service] [label] | status | accept");
