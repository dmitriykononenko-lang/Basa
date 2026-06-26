"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { IconKey } from "@/components/icons";
import type { VaultEntry, VaultGrant, VaultLogRow } from "@/lib/vault";
import VaultAccess from "@/components/vault/VaultAccess";

type Member = { id: string; name: string };
type Opt = { value: string; label: string };

type Draft = { id?: string; title: string; login: string; url: string; note: string; secret: string };
const EMPTY: Draft = { title: "", login: "", url: "", note: "", secret: "" };

export default function VaultManager({
  teamId,
  entries,
  canManage,
  canGrant,
  members,
  unitOptions,
  unitName,
  grantsByEntry,
  logByEntry,
}: {
  teamId: string;
  entries: VaultEntry[];
  canManage: boolean;
  canGrant: boolean;
  members: Member[];
  unitOptions: Opt[];
  unitName: Record<string, string>;
  grantsByEntry: Record<string, VaultGrant[]>;
  logByEntry: Record<string, VaultLogRow[]>;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [accessEntry, setAccessEntry] = useState<VaultEntry | null>(null);

  const memberName = new Map(members.map((m) => [m.id, m.name]));

  function openCreate() {
    setDraft(EMPTY);
    setEditOpen(true);
  }
  function openEdit(e: VaultEntry) {
    setDraft({ id: e.id, title: e.title, login: e.login, url: e.url, note: e.note, secret: "" });
    setEditOpen(true);
  }

  async function save() {
    if (!draft.title.trim()) {
      toast.error("Укажите название");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: draft.id,
        title: draft.title,
        login: draft.login,
        url: draft.url,
        note: draft.note,
        secret: draft.secret || undefined,
      }),
    });
    setBusy(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Не удалось сохранить");
      return;
    }
    toast.success("Сохранено");
    setEditOpen(false);
    router.refresh();
  }

  async function remove(e: VaultEntry) {
    if (!confirm(`Удалить запись «${e.title}»? Действие необратимо.`)) return;
    const res = await fetch(`/api/vault?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Не удалось удалить");
      return;
    }
    toast.success("Удалено");
    router.refresh();
  }

  async function reveal(e: VaultEntry) {
    setRevealed(null);
    const res = await fetch(`/api/vault/${encodeURIComponent(e.id)}/reveal`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Не удалось показать пароль");
      return;
    }
    setRevealed({ id: e.id, secret: json.secret });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  function accessSummary(entryId: string): string {
    const gs = grantsByEntry[entryId] ?? [];
    if (gs.length === 0) return "только владелец/админ и автор";
    const users = gs.filter((g) => g.subject_type === "user").length;
    const units = gs.filter((g) => g.subject_type === "unit").length;
    const parts: string[] = [];
    if (units) parts.push(`узлов: ${units}`);
    if (users) parts.push(`сотрудников: ${users}`);
    return parts.join(" · ");
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-slate-400">{entries.length > 0 ? `Записей: ${entries.length}` : ""}</div>
        {canManage && <button type="button" onClick={openCreate} className="btn-primary text-sm">+ Пароль</button>}
      </div>

      {entries.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((e) => {
            const isRevealed = revealed?.id === e.id;
            return (
              <li key={e.id} className="surface flex h-full flex-col rounded-3xl p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-xl bg-brand/10 p-2 text-brand"><IconKey className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-slate-900 dark:text-white">{e.title}</h3>
                    {e.login && <div className="truncate text-xs text-slate-500 dark:text-neutral-400">{e.login}</div>}
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-brand hover:underline">{e.url}</a>
                    )}
                  </div>
                </div>

                {e.note && <p className="mt-3 line-clamp-2 text-xs text-slate-500 dark:text-neutral-400">{e.note}</p>}

                <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
                  {isRevealed ? (
                    <div className="flex items-center justify-between gap-2">
                      <code className="break-all text-sm text-slate-800 dark:text-neutral-100">{revealed!.secret}</code>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => copy(revealed!.secret)} className="btn-ghost px-2 py-1 text-xs">Копировать</button>
                        <button type="button" onClick={() => setRevealed(null)} className="btn-ghost px-2 py-1 text-xs">Скрыть</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="tracking-widest text-slate-400">••••••••••</span>
                      <button type="button" onClick={() => reveal(e)} className="btn-ghost px-2 py-1 text-xs">Показать</button>
                    </div>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  {canGrant ? (
                    <button type="button" onClick={() => setAccessEntry(e)} className="text-xs text-slate-500 hover:text-brand dark:text-neutral-400">
                      Доступ: {accessSummary(e.id)}
                    </button>
                  ) : (
                    <span />
                  )}
                  {canManage && (
                    <span className="flex gap-1">
                      <button type="button" onClick={() => openEdit(e)} className="btn-ghost px-2 py-1 text-xs">Изменить</button>
                      <button type="button" onClick={() => remove(e)} className="btn-ghost px-2 py-1 text-xs">Удалить</button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon="🔑"
          title={canManage ? "Паролей пока нет" : "Вам пока не выдан доступ к паролям"}
          description={canManage ? "Добавьте первый пароль и выдайте доступ сотрудникам или узлам оргструктуры." : "Когда вам выдадут доступ, пароли появятся здесь."}
        />
      )}

      {/* Добавление / редактирование записи */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={draft.id ? "Изменить пароль" : "Новый пароль"} size="md">
        <div className="space-y-4">
          <Field label="Название">
            <input value={draft.title} onChange={(ev) => setDraft({ ...draft, title: ev.target.value })} className="input" placeholder="Например, Корп. почта" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Логин (необяз.)">
              <input value={draft.login} onChange={(ev) => setDraft({ ...draft, login: ev.target.value })} className="input" placeholder="user@company.com" />
            </Field>
            <Field label="Ссылка (необяз.)">
              <input value={draft.url} onChange={(ev) => setDraft({ ...draft, url: ev.target.value })} className="input" placeholder="https://…" />
            </Field>
          </div>
          <Field label={draft.id ? "Новый пароль (оставьте пустым, чтобы не менять)" : "Пароль"}>
            <input value={draft.secret} onChange={(ev) => setDraft({ ...draft, secret: ev.target.value })} className="input" placeholder="••••••••" autoComplete="new-password" />
          </Field>
          <Field label="Заметка (необяз.)">
            <textarea value={draft.note} onChange={(ev) => setDraft({ ...draft, note: ev.target.value })} rows={2} className="input resize-y" placeholder="Контекст, где используется" />
          </Field>
          <p className="text-xs text-slate-400">Пароль шифруется на сервере; в базе хранится только шифртекст.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </Modal>

      {/* Управление доступом + журнал */}
      {accessEntry && (
        <Modal open={!!accessEntry} onClose={() => setAccessEntry(null)} title={`Доступ к «${accessEntry.title}»`} size="lg">
          <VaultAccess
            teamId={teamId}
            entryId={accessEntry.id}
            members={members}
            unitOptions={unitOptions}
            unitName={unitName}
            memberName={Object.fromEntries(memberName)}
            grants={grantsByEntry[accessEntry.id] ?? []}
            log={logByEntry[accessEntry.id] ?? []}
          />
        </Modal>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
