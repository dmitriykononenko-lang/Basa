"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { IconKey } from "@/components/icons";
import type { VaultEntry, VaultGrant, VaultLogRow, VaultProject } from "@/lib/vault";
import VaultAccess from "@/components/vault/VaultAccess";

type Member = { id: string; name: string };
type Opt = { value: string; label: string };
type ViewMode = "cards" | "list";

type Draft = {
  id?: string;
  title: string;
  login: string;
  url: string;
  note: string;
  secret: string;
  group_name: string;
  project_id: string;
};
const EMPTY: Draft = { title: "", login: "", url: "", note: "", secret: "", group_name: "", project_id: "" };

const NO_GROUP = "Без группы";
const NO_PROJECT = "Без проекта";

export default function VaultManager({
  teamId,
  entries,
  projects,
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
  projects: VaultProject[];
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
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("cards");
  const [groupBy, setGroupBy] = useState<"group" | "project">("group");
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState({ changeGroup: false, group: "", changeProject: false, project: "" });

  // Режим отображения и группировку запоминаем между сессиями.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("vault:view");
    if (saved === "cards" || saved === "list") setView(saved);
    const savedG = window.localStorage.getItem("vault:groupBy");
    if (savedG === "group" || savedG === "project") setGroupBy(savedG);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("vault:view", view);
  }, [view]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("vault:groupBy", groupBy);
  }, [groupBy]);

  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const groupSuggestions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.group_name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  // Поиск по названию / логину / ссылке / группе / проекту.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.title, e.login, e.url, e.group_name, e.project_name ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  // Группировка по группам или по проектам; безымянная корзина — в конце.
  const groups = useMemo(() => {
    const none = groupBy === "project" ? NO_PROJECT : NO_GROUP;
    const map = new Map<string, VaultEntry[]>();
    for (const e of filtered) {
      const key = (groupBy === "project" ? (e.project_name ?? "") : e.group_name) || none;
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === none) return 1;
      if (b[0] === none) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered, groupBy]);

  function openCreate() {
    setDraft(EMPTY);
    setEditOpen(true);
  }
  function openEdit(e: VaultEntry) {
    setDraft({
      id: e.id,
      title: e.title,
      login: e.login,
      url: e.url,
      note: e.note,
      secret: "",
      group_name: e.group_name,
      project_id: e.project_id ?? "",
    });
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
        group_name: draft.group_name,
        project_id: draft.project_id || null,
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

  async function requestAccess(e: VaultEntry) {
    const res = await fetch(`/api/vault/${encodeURIComponent(e.id)}/request-access`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Не удалось отправить запрос");
      return;
    }
    setRequested((prev) => new Set(prev).add(e.id));
    toast.success((json.notified ?? 0) > 0 ? "Запрос отправлен владельцу/админу" : "Запрос отправлен");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applyBulk() {
    if (!bulk.changeGroup && !bulk.changeProject) {
      toast.error("Выберите, что изменить");
      return;
    }
    const body: Record<string, unknown> = { ids: [...selected] };
    if (bulk.changeGroup) body.group_name = bulk.group;
    if (bulk.changeProject) body.project_id = bulk.project || null;
    setBusy(true);
    const res = await fetch("/api/vault", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Не удалось применить");
      return;
    }
    toast.success(`Обновлено записей: ${json.updated ?? selected.size}`);
    setBulkOpen(false);
    setBulk({ changeGroup: false, group: "", changeProject: false, project: "" });
    setSelected(new Set());
    router.refresh();
  }

  function accessSummary(e: VaultEntry): string {
    const gs = grantsByEntry[e.id] ?? [];
    const parts: string[] = [];
    const users = gs.filter((g) => g.subject_type === "user").length;
    const units = gs.filter((g) => g.subject_type === "unit").length;
    if (units) parts.push(`узлов: ${units}`);
    if (users) parts.push(`сотрудников: ${users}`);
    if (e.project_name) parts.push(`проект «${e.project_name}»`);
    return parts.length ? parts.join(" · ") : "только владелец/админ и автор";
  }

  const shown = filtered.length;
  const total = entries.length;

  function itemProps(e: VaultEntry): ItemProps {
    return {
      e,
      revealedSecret: revealed?.id === e.id ? revealed!.secret : null,
      requested: requested.has(e.id),
      canManage,
      canGrant,
      selectable: canManage,
      selected: selected.has(e.id),
      accessLabel: accessSummary(e),
      onReveal: () => reveal(e),
      onHide: () => setRevealed(null),
      onRequest: () => requestAccess(e),
      onCopy: copy,
      onEdit: () => openEdit(e),
      onRemove: () => remove(e),
      onAccess: () => setAccessEntry(e),
      onToggleSelect: () => toggleSelect(e.id),
    };
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по всем паролям…"
            className="input h-9 w-full sm:w-72"
          />
          <span className="whitespace-nowrap text-sm text-slate-400">
            {query ? `${shown} из ${total}` : `Записей: ${total}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 p-0.5 dark:border-white/10" title="Группировать список">
            <button
              type="button"
              onClick={() => setGroupBy("group")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${groupBy === "group" ? "bg-brand/10 text-brand" : "text-slate-500 dark:text-neutral-400"}`}
            >
              Группы
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("project")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${groupBy === "project" ? "bg-brand/10 text-brand" : "text-slate-500 dark:text-neutral-400"}`}
            >
              Проекты
            </button>
          </div>
          <div className="flex rounded-xl border border-slate-200 p-0.5 dark:border-white/10">
            <button
              type="button"
              onClick={() => setView("cards")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${view === "cards" ? "bg-brand/10 text-brand" : "text-slate-500 dark:text-neutral-400"}`}
            >
              Карточки
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${view === "list" ? "bg-brand/10 text-brand" : "text-slate-500 dark:text-neutral-400"}`}
            >
              Список
            </button>
          </div>
          {canManage && <button type="button" onClick={openCreate} className="btn-primary text-sm">+ Пароль</button>}
        </div>
      </div>

      {canManage && selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-2.5">
          <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">Выбрано: {selected.size}</span>
          <button type="button" onClick={() => setBulkOpen(true)} className="btn-primary text-xs">Назначить группу / проект</button>
          <button type="button" onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Снять выбор</button>
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon="🔑"
          title="Паролей пока нет"
          description={canManage ? "Добавьте первый пароль, сгруппируйте записи и выдайте доступ сотрудникам, узлам или через привязку к проекту." : "Здесь появятся пароли команды. Те, к которым у вас нет доступа, будут показаны под замком."}
        />
      ) : shown === 0 ? (
        <EmptyState icon="🔍" title="Ничего не найдено" description="Измените поисковый запрос." />
      ) : (
        <div className="space-y-6">
          {groups.map(([groupName, items]) => (
            <section key={groupName}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{groupName}</h2>
                <span className="text-xs text-slate-300 dark:text-neutral-600">{items.length}</span>
                <div className="h-px flex-1 bg-slate-100 dark:bg-white/5" />
              </div>

              {view === "cards" ? (
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((e) => <VaultCard key={e.id} {...itemProps(e)} />)}
                </ul>
              ) : (
                <ul className="surface divide-y divide-slate-100 overflow-hidden rounded-2xl dark:divide-white/5">
                  {items.map((e) => <VaultRow key={e.id} {...itemProps(e)} />)}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Список групп для автоподсказок (используется в обеих модалках) */}
      <datalist id="vault-groups">
        {groupSuggestions.map((g) => <option key={g} value={g} />)}
      </datalist>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Группа (необяз.)">
              <input
                value={draft.group_name}
                onChange={(ev) => setDraft({ ...draft, group_name: ev.target.value })}
                className="input"
                placeholder="Например, Почты"
                list="vault-groups"
              />
            </Field>
            <Field label="Проект (необяз.)">
              <select value={draft.project_id} onChange={(ev) => setDraft({ ...draft, project_id: ev.target.value })} className="input">
                <option value="">— без проекта —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={draft.id ? "Новый пароль (оставьте пустым, чтобы не менять)" : "Пароль"}>
            <input value={draft.secret} onChange={(ev) => setDraft({ ...draft, secret: ev.target.value })} className="input" placeholder="••••••••" autoComplete="new-password" />
          </Field>
          <Field label="Заметка (необяз.)">
            <textarea value={draft.note} onChange={(ev) => setDraft({ ...draft, note: ev.target.value })} rows={2} className="input resize-y" placeholder="Контекст, где используется" />
          </Field>
          <p className="text-xs text-slate-400">
            Пароль шифруется на сервере; в базе хранится только шифртекст. Привязка к проекту автоматически открывает
            пароль ответственному и менеджеру этого проекта.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </Modal>

      {/* Массовое назначение группы / проекта */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Массовое назначение · ${selected.size}`} size="md">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-neutral-200">
            <input type="checkbox" checked={bulk.changeGroup} onChange={(ev) => setBulk({ ...bulk, changeGroup: ev.target.checked })} />
            Изменить группу
          </label>
          {bulk.changeGroup && (
            <input
              value={bulk.group}
              onChange={(ev) => setBulk({ ...bulk, group: ev.target.value })}
              className="input"
              list="vault-groups"
              placeholder="Название группы (пусто — убрать из группы)"
            />
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-neutral-200">
            <input type="checkbox" checked={bulk.changeProject} onChange={(ev) => setBulk({ ...bulk, changeProject: ev.target.checked })} />
            Изменить проект
          </label>
          {bulk.changeProject && (
            <select value={bulk.project} onChange={(ev) => setBulk({ ...bulk, project: ev.target.value })} className="input">
              <option value="">— без проекта —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <p className="text-xs text-slate-400">Изменения применятся к {selected.size} выбранным записям.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setBulkOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={applyBulk} className="btn-primary">{busy ? "…" : "Применить"}</button>
          </div>
        </div>
      </Modal>

      {/* Управление доступом + журнал */}
      {accessEntry && (
        <Modal open={!!accessEntry} onClose={() => setAccessEntry(null)} title={`Доступ к «${accessEntry.title}»`} size="lg">
          {accessEntry.project_name && (
            <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-white/[0.03] dark:text-neutral-400">
              Привязан к проекту «{accessEntry.project_name}»: доступ автоматически есть у ответственного и менеджера проекта.
            </p>
          )}
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

type ItemProps = {
  e: VaultEntry;
  revealedSecret: string | null;
  requested: boolean;
  canManage: boolean;
  canGrant: boolean;
  selectable: boolean;
  selected: boolean;
  accessLabel: string;
  onReveal: () => void;
  onHide: () => void;
  onRequest: () => void;
  onCopy: (t: string) => void;
  onEdit: () => void;
  onRemove: () => void;
  onAccess: () => void;
  onToggleSelect: () => void;
};

function ProjectBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
      {name}
    </span>
  );
}

function SecretBox({ e, revealedSecret, requested, onReveal, onHide, onRequest, onCopy }: Pick<ItemProps, "e" | "revealedSecret" | "requested" | "onReveal" | "onHide" | "onRequest" | "onCopy">) {
  if (!e.can_reveal) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-slate-400"><span aria-hidden>🔒</span> Доступ закрыт</span>
        {requested ? (
          <span className="text-xs text-slate-400">Запрошено</span>
        ) : (
          <button type="button" onClick={onRequest} className="btn-ghost px-2 py-1 text-xs">Запросить доступ</button>
        )}
      </div>
    );
  }
  if (revealedSecret !== null) {
    return (
      <div className="flex items-center justify-between gap-2">
        <code className="break-all text-sm text-slate-800 dark:text-neutral-100">{revealedSecret}</code>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => onCopy(revealedSecret)} className="btn-ghost px-2 py-1 text-xs">Копировать</button>
          <button type="button" onClick={onHide} className="btn-ghost px-2 py-1 text-xs">Скрыть</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="tracking-widest text-slate-400">••••••••••</span>
      <button type="button" onClick={onReveal} disabled={!e.has_secret} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">
        {e.has_secret ? "Показать" : "Нет пароля"}
      </button>
    </div>
  );
}

function VaultCard(p: ItemProps) {
  const { e, canManage, canGrant, selectable, selected, accessLabel } = p;
  return (
    <li className={`surface flex h-full flex-col rounded-3xl p-5 ${selected ? "ring-2 ring-brand" : ""}`}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input type="checkbox" checked={selected} onChange={p.onToggleSelect} className="mt-1.5" aria-label="Выбрать запись" />
        )}
        <span className={`mt-0.5 rounded-xl p-2 ${e.can_reveal ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-400 dark:bg-white/5"}`}>
          <IconKey className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-slate-900 dark:text-white">{e.title}</h3>
            {e.project_name && <ProjectBadge name={e.project_name} />}
          </div>
          {e.login && <div className="truncate text-xs text-slate-500 dark:text-neutral-400">{e.login}</div>}
          {e.url && (
            <a href={e.url} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-brand hover:underline">{e.url}</a>
          )}
        </div>
      </div>

      {e.note && <p className="mt-3 line-clamp-2 text-xs text-slate-500 dark:text-neutral-400">{e.note}</p>}

      <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
        <SecretBox e={e} revealedSecret={p.revealedSecret} requested={p.requested} onReveal={p.onReveal} onHide={p.onHide} onRequest={p.onRequest} onCopy={p.onCopy} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        {canGrant ? (
          <button type="button" onClick={p.onAccess} className="truncate text-xs text-slate-500 hover:text-brand dark:text-neutral-400">
            Доступ: {accessLabel}
          </button>
        ) : (
          <span />
        )}
        {canManage && (
          <span className="flex shrink-0 gap-1">
            <button type="button" onClick={p.onEdit} className="btn-ghost px-2 py-1 text-xs">Изменить</button>
            <button type="button" onClick={p.onRemove} className="btn-ghost px-2 py-1 text-xs">Удалить</button>
          </span>
        )}
      </div>
    </li>
  );
}

function VaultRow(p: ItemProps) {
  const { e, canManage, canGrant, selectable, selected } = p;
  return (
    <li className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${selected ? "bg-brand/5" : ""}`}>
      {selectable && (
        <input type="checkbox" checked={selected} onChange={p.onToggleSelect} className="shrink-0" aria-label="Выбрать запись" />
      )}
      <span className={`hidden shrink-0 rounded-lg p-1.5 sm:block ${e.can_reveal ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-400 dark:bg-white/5"}`}>
        <IconKey className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-900 dark:text-white">{e.title}</span>
          {e.project_name && <ProjectBadge name={e.project_name} />}
        </div>
        {e.login && <div className="truncate text-xs text-slate-500 dark:text-neutral-400">{e.login}</div>}
      </div>
      <div className="min-w-0 sm:w-64">
        <SecretBox e={e} revealedSecret={p.revealedSecret} requested={p.requested} onReveal={p.onReveal} onHide={p.onHide} onRequest={p.onRequest} onCopy={p.onCopy} />
      </div>
      {(canGrant || canManage) && (
        <div className="flex shrink-0 items-center gap-1">
          {canGrant && (
            <button type="button" onClick={p.onAccess} className="btn-ghost px-2 py-1 text-xs" title={`Доступ: ${p.accessLabel}`}>Доступ</button>
          )}
          {canManage && (
            <>
              <button type="button" onClick={p.onEdit} className="btn-ghost px-2 py-1 text-xs">Изменить</button>
              <button type="button" onClick={p.onRemove} className="btn-ghost px-2 py-1 text-xs">Удалить</button>
            </>
          )}
        </div>
      )}
    </li>
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
