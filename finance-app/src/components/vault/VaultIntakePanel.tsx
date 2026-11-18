"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import {
  generateTeamKey, unlockTeamKey, openSealed, MIN_PASSPHRASE_LENGTH, type WrappedPrivateKey,
} from "@/lib/intake-crypto";
import { INTAKE_SERVICES, serviceTitle, draftEntry, type IntakePayload, type IntakeServiceKind } from "@/lib/intake-form";

export type IntakeRequestRow = {
  id: string;
  service_kind: IntakeServiceKind;
  service_label: string;
  client_name: string;
  project_name: string | null;
  counterparty_name: string | null;
  requester_name: string;
  status: "pending" | "opened" | "submitted" | "accepted" | "revoked" | "expired";
  expires_at: string;
  open_count: number;
  opened_at: string | null;
  submitted_at: string | null;
  user_added: boolean;
  fallback_used: boolean;
  key_id: string;
  payload_cipher: string | null;
  entry_id: string | null;
  created_at: string;
};

export type TeamKeyRow = { id: string; active: boolean; wrapped_private_key: WrappedPrivateKey; created_at: string };
type Opt = { id: string; name: string };

const STATUS: Record<IntakeRequestRow["status"], { label: string; cls: string }> = {
  pending: { label: "Ждём клиента", cls: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-neutral-300" },
  opened: { label: "Клиент открыл", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  submitted: { label: "Ждёт приёма", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  accepted: { label: "Принят", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  revoked: { label: "Отозван", cls: "bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-neutral-500" },
  expired: { label: "Истёк", cls: "bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-neutral-500" },
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// Шаблон сообщения клиенту (без пароля, только ссылка и срок).
function clientMessage(service: string, url: string, expires: string) {
  return (
    `Здравствуйте! Чтобы не пересылать пароли в чате, передайте, пожалуйста, доступ к ${service} по защищённой ссылке:\n${url}\n\n` +
    `Ссылка одноразовая и действует до ${fmt(expires)}. Адрес страницы всегда access.koagency.me. ` +
    `Коды из SMS в чат присылать не нужно.`
  );
}

export default function VaultIntakePanel({
  requests, keys, projects, clients, canGrant, agencyEmail, defaultOpen, defaultProjectId,
}: {
  requests: IntakeRequestRow[];
  keys: TeamKeyRow[];
  projects: Opt[];
  clients: Opt[];
  canGrant: boolean;
  agencyEmail: string;
  defaultOpen?: boolean;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const hasKey = keys.some((k) => k.active);
  const [createOpen, setCreateOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; expires_at: string; service: string } | null>(null);
  const [form, setForm] = useState({ service_kind: "amocrm" as IntakeServiceKind, service_label: "", project_id: defaultProjectId ?? "", counterparty_id: "", client_name: "" });
  const [pass, setPass] = useState({ a: "", b: "" });
  const [unlockPass, setUnlockPass] = useState("");
  // Разблокированные закрытые ключи — только в памяти вкладки, по key_id.
  const [unlocked, setUnlocked] = useState<Record<string, CryptoKey>>({});
  const [pendingAccept, setPendingAccept] = useState<IntakeRequestRow | null>(null);
  const [accept, setAccept] = useState<{ req: IntakeRequestRow; title: string; login: string; url: string; note: string; secret: string; group: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    if (defaultOpen && hasKey) setCreateOpen(true);
  }, [defaultOpen, hasKey]);

  const active = useMemo(() => requests.filter((r) => ["pending", "opened", "submitted"].includes(r.status)), [requests]);
  const closed = useMemo(() => requests.filter((r) => !["pending", "opened", "submitted"].includes(r.status)), [requests]);
  const waiting = active.filter((r) => r.status === "submitted").length;

  async function createKey() {
    if (pass.a.length < MIN_PASSPHRASE_LENGTH) return toast(`Пароль ключа — не короче ${MIN_PASSPHRASE_LENGTH} символов`, "error");
    if (pass.a !== pass.b) return toast("Пароли не совпадают", "error");
    setBusy(true);
    try {
      const { publicKey, wrapped } = await generateTeamKey(pass.a);
      const res = await fetch("/api/vault/intake/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: publicKey, wrapped }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Не удалось сохранить ключ");
      toast("Ключ команды создан");
      setPass({ a: "", b: "" });
      setKeyOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createRequest() {
    setBusy(true);
    try {
      const res = await fetch("/api/vault/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_kind: form.service_kind,
          service_label: form.service_label,
          project_id: form.project_id || null,
          counterparty_id: form.counterparty_id || null,
          client_name: form.client_name,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Не удалось создать запрос");
      setCreated({ url: d.url, expires_at: d.expires_at, service: serviceTitle(form.service_kind, form.service_label) });
      setCreateOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(r: IntakeRequestRow) {
    if (!confirm(`Отозвать ссылку «${serviceTitle(r.service_kind, r.service_label)}» для ${r.client_name || "клиента"}?`)) return;
    const res = await fetch(`/api/vault/intake?id=${r.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || "Не удалось отозвать", "error");
    toast("Ссылка отозвана");
    router.refresh();
  }

  async function startAccept(r: IntakeRequestRow, keyOverride?: CryptoKey) {
    const key = keyOverride ?? unlocked[r.key_id];
    if (!key) {
      setPendingAccept(r);
      setUnlockOpen(true);
      return;
    }
    if (!r.payload_cipher) return toast("Данных нет — запрос закрыт", "error");
    try {
      const payload = await openSealed<IntakePayload>(key, r.id, r.payload_cipher);
      const d = draftEntry(payload, {
        serviceLabel: r.service_label,
        clientName: r.client_name,
        agencyEmail,
        submittedAt: fmt(r.submitted_at),
      });
      setShowSecret(false);
      setAccept({ req: r, title: d.title, login: d.login, url: d.url, note: d.note, secret: d.secret, group: d.group });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось расшифровать", "error");
    }
  }

  async function unlock() {
    const target = pendingAccept;
    const keyRow = keys.find((k) => k.id === (target?.key_id ?? keys.find((x) => x.active)?.id));
    if (!keyRow) return toast("Ключ этого запроса не найден", "error");
    setBusy(true);
    try {
      const k = await unlockTeamKey(keyRow.wrapped_private_key, unlockPass);
      setUnlocked((u) => ({ ...u, [keyRow.id]: k }));
      setUnlockPass("");
      setUnlockOpen(false);
      setPendingAccept(null);
      if (target) await startAccept(target, k);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Неверный пароль", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccept() {
    if (!accept) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/vault/intake/${accept.req.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: accept.title, login: accept.login, url: accept.url, note: accept.note,
          secret: accept.secret || undefined, group_name: accept.group,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Не удалось сохранить");
      toast("Запись добавлена в парольницу");
      setAccept(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setBusy(false);
    }
  }

  const copy = async (text: string, msg = "Скопировано") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast("Не удалось скопировать — выделите текст вручную", "error");
    }
  };

  return (
    <section id="intake" className="surface mb-5 rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Запросы клиентам {waiting > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{waiting} ждёт приёма</span>}
          </h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Одноразовая ссылка на 48 часов: клиент сам передаёт доступ, данные шифруются в его браузере ключом команды.
          </p>
        </div>
        <div className="flex gap-2">
          {canGrant && (
            <button type="button" onClick={() => setKeyOpen(true)} className="btn-ghost text-xs">
              {hasKey ? "Ключ команды" : "Создать ключ команды"}
            </button>
          )}
          <button type="button" disabled={!hasKey} onClick={() => setCreateOpen(true)} className="btn-primary text-sm disabled:opacity-40">
            Запросить доступ у клиента
          </button>
        </div>
      </div>

      {!hasKey && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {canGrant
            ? "Сначала создайте ключ команды: им клиенты шифруют данные, а открыть их можно только вашим паролем ключа."
            : "Владелец или админ должен один раз создать ключ команды — после этого здесь можно будет запрашивать доступы."}
        </p>
      )}

      {active.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
          {active.map((r) => <Row key={r.id} r={r} canGrant={canGrant} onRevoke={() => revoke(r)} onAccept={() => startAccept(r)} />)}
        </ul>
      )}
      {active.length === 0 && hasKey && <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Открытых запросов нет.</p>}

      {closed.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowClosed((s) => !s)} className="text-xs text-slate-500 hover:underline">
            {showClosed ? "Скрыть закрытые" : `Показать закрытые (${closed.length})`}
          </button>
          {showClosed && (
            <ul className="mt-2 divide-y divide-slate-100 opacity-80 dark:divide-white/5">
              {closed.map((r) => <Row key={r.id} r={r} canGrant={false} />)}
            </ul>
          )}
        </div>
      )}

      {/* Создание запроса */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Запросить доступ у клиента">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-neutral-400">Сервис</span>
            <select className="input mt-1" value={form.service_kind} onChange={(e) => setForm({ ...form, service_kind: e.target.value as IntakeServiceKind })}>
              {INTAKE_SERVICES.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              {form.service_kind === "other" ? "Клиент передаст логин и пароль." : "Клиент сначала увидит инструкцию «добавьте нас пользователем»; пароль — только если не получится."}
            </span>
          </label>
          {form.service_kind === "other" && (
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-neutral-400">Название сервиса</span>
              <input className="input mt-1" value={form.service_label} onChange={(e) => setForm({ ...form, service_label: e.target.value })} placeholder="Например, Radist или хостинг сайта" maxLength={120} />
            </label>
          )}
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-neutral-400">Проект</span>
            <select className="input mt-1" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">— без проекта —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-400">Запись откроется ответственному и менеджеру проекта.</span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-neutral-400">Клиент (контрагент)</span>
            <select className="input mt-1" value={form.counterparty_id} onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}>
              <option value="">— не выбран —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-neutral-400">Название компании на странице клиента</span>
            <input className="input mt-1" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="По умолчанию — имя контрагента или проекта" maxLength={120} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={createRequest} className="btn-primary">{busy ? "…" : "Создать ссылку"}</button>
          </div>
        </div>
      </Modal>

      {/* Ссылка — показывается один раз */}
      <Modal open={!!created} onClose={() => setCreated(null)} title="Ссылка для клиента">
        {created && (
          <div className="space-y-3 text-sm">
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-red-800 dark:bg-red-500/10 dark:text-red-200">
              Ссылка показывается один раз — в Basa хранится только её отпечаток. Скопируйте и отправьте клиенту в его рабочий чат.
            </p>
            <div className="break-all rounded-2xl bg-slate-100 px-4 py-3 font-mono text-xs dark:bg-neutral-800">{created.url}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm" onClick={() => copy(clientMessage(created.service, created.url, created.expires_at), "Сообщение скопировано")}>
                Копировать сообщение клиенту
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={() => copy(created.url, "Ссылка скопирована")}>Только ссылку</button>
            </div>
            <pre className="whitespace-pre-wrap rounded-2xl border border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-white/10 dark:text-neutral-300">
              {clientMessage(created.service, created.url, created.expires_at)}
            </pre>
          </div>
        )}
      </Modal>

      {/* Ключ команды */}
      <Modal open={keyOpen} onClose={() => setKeyOpen(false)} title={hasKey ? "Ключ команды" : "Создать ключ команды"}>
        <div className="space-y-3 text-sm text-slate-600 dark:text-neutral-300">
          {hasKey && (
            <p>
              Ключ создан {fmt(keys.find((k) => k.active)?.created_at ?? null)}. Новый ключ нужен, только если пароль мог
              стать известен посторонним. Уже отправленные запросы по-прежнему открываются старым паролем.
            </p>
          )}
          <p>
            Пара ключей создаётся в этом браузере. Открытый ключ получат клиенты, закрытый сохранится в Basa
            <b> только зашифрованным вашим паролем</b>. Сервер его прочитать не может.
          </p>
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-red-800 dark:bg-red-500/10 dark:text-red-200">
            Пароль ключа нигде не хранится и не восстанавливается. Запишите его в личный менеджер паролей.
            Без него неразобранные запросы открыть нельзя — клиенту придётся отправить данные заново.
          </p>
          <input className="input" type="password" autoComplete="new-password" placeholder={`Пароль ключа (не короче ${MIN_PASSPHRASE_LENGTH} символов)`} value={pass.a} onChange={(e) => setPass({ ...pass, a: e.target.value })} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Повторите пароль" value={pass.b} onChange={(e) => setPass({ ...pass, b: e.target.value })} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setKeyOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={createKey} className="btn-primary">{busy ? "Создаём…" : hasKey ? "Заменить ключ" : "Создать ключ"}</button>
          </div>
        </div>
      </Modal>

      {/* Разблокировка ключа */}
      <Modal open={unlockOpen} onClose={() => { setUnlockOpen(false); setPendingAccept(null); }} title="Пароль ключа команды">
        <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <p className="text-slate-600 dark:text-neutral-300">Ключ расшифровывается в этом браузере и хранится только до закрытия вкладки.</p>
          <input className="input" type="password" autoFocus autoComplete="current-password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setUnlockOpen(false); setPendingAccept(null); }} className="btn-ghost">Отмена</button>
            <button type="submit" disabled={busy || !unlockPass} className="btn-primary">{busy ? "Проверяем…" : "Открыть"}</button>
          </div>
        </form>
      </Modal>

      {/* Приём записи */}
      <Modal open={!!accept} onClose={() => setAccept(null)} title="Принять в парольницу" size="lg">
        {accept && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Проверьте данные. После сохранения запись появится в парольнице
              {accept.req.project_name ? ` с привязкой к проекту «${accept.req.project_name}»` : ""}
              {accept.req.counterparty_name ? ` и клиенту «${accept.req.counterparty_name}»` : ""}, а зашифрованный запрос удалится.
            </p>
            <label className="block"><span className="text-slate-600 dark:text-neutral-400">Название</span>
              <input className="input mt-1" value={accept.title} onChange={(e) => setAccept({ ...accept, title: e.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-slate-600 dark:text-neutral-400">Логин</span>
                <input className="input mt-1" value={accept.login} onChange={(e) => setAccept({ ...accept, login: e.target.value })} /></label>
              <label className="block"><span className="text-slate-600 dark:text-neutral-400">Ссылка</span>
                <input className="input mt-1" value={accept.url} onChange={(e) => setAccept({ ...accept, url: e.target.value })} /></label>
            </div>
            {accept.secret ? (
              <label className="block"><span className="text-slate-600 dark:text-neutral-400">Пароль</span>
                <div className="mt-1 flex gap-2">
                  <input className="input" type={showSecret ? "text" : "password"} value={accept.secret} onChange={(e) => setAccept({ ...accept, secret: e.target.value })} />
                  <button type="button" className="btn-ghost text-xs" onClick={() => setShowSecret((s) => !s)}>{showSecret ? "Скрыть" : "Показать"}</button>
                </div></label>
            ) : (
              <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">Пароль не передавался — клиент добавил нас пользователем. Проверьте вход.</p>
            )}
            <label className="block"><span className="text-slate-600 dark:text-neutral-400">Группа</span>
              <input className="input mt-1" value={accept.group} onChange={(e) => setAccept({ ...accept, group: e.target.value })} /></label>
            <label className="block"><span className="text-slate-600 dark:text-neutral-400">Заметка</span>
              <textarea className="input mt-1 min-h-[120px]" value={accept.note} onChange={(e) => setAccept({ ...accept, note: e.target.value })} /></label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAccept(null)} className="btn-ghost">Отмена</button>
              <button type="button" disabled={busy} onClick={saveAccept} className="btn-primary">{busy ? "…" : "Сохранить в парольницу"}</button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Row({ r, canGrant, onRevoke, onAccept }: { r: IntakeRequestRow; canGrant: boolean; onRevoke?: () => void; onAccept?: () => void }) {
  const st = STATUS[r.status];
  const where = [r.project_name, r.counterparty_name].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900 dark:text-white">{serviceTitle(r.service_kind, r.service_label)}</span>
          <span className="text-slate-500 dark:text-neutral-400">· {r.client_name || "клиент"}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
          {r.status === "submitted" && r.user_added && !r.fallback_used && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">добавил нас пользователем</span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {where && <>{where} · </>}
          создал {r.requester_name} {fmt(r.created_at)}
          {r.open_count > 0 && <> · открыт {r.open_count}× (первый раз {fmt(r.opened_at)})</>}
          {r.submitted_at && <> · отправлен {fmt(r.submitted_at)}</>}
          {["pending", "opened"].includes(r.status) && <> · до {fmt(r.expires_at)}</>}
        </div>
      </div>
      <div className="flex gap-2">
        {r.status === "submitted" && canGrant && onAccept && (
          <button type="button" onClick={onAccept} className="btn-primary px-3 py-1.5 text-xs">Принять</button>
        )}
        {["pending", "opened", "submitted"].includes(r.status) && onRevoke && (
          <button type="button" onClick={onRevoke} className="btn-ghost px-3 py-1.5 text-xs">Отозвать</button>
        )}
      </div>
    </li>
  );
}
