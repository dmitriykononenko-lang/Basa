"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { ROLE_LABELS, type AppRole } from "@/lib/types";

const ROLES: AppRole[] = ["admin", "manager", "employee", "viewer"];

// Пригласить сотрудника из карточки: приглашение привязывается к counterparty,
// и при входе учётка сама привяжется к этой карточке (accept_invite).
export default function InviteEmployee({
  teamId,
  counterpartyId,
  name,
  defaultEmail,
}: {
  teamId: string;
  counterpartyId: string;
  name: string;
  defaultEmail?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [role, setRole] = useState<AppRole>("employee");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ emailed: boolean; link: string; note: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (!email.trim()) return toast.error("Укажите email");
    setBusy(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, email, role, counterpartyId }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || "Ошибка");
      setResult({ emailed: data.emailed, link: data.link, note: data.emailNote });
      if (data.emailed) toast.success("Приглашение отправлено");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setResult(null);
    setCopied(false);
    setEmail(defaultEmail ?? "");
    setRole("employee");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand transition hover:bg-brand/20"
      >
        Пригласить
      </button>

      <Modal open={open} onClose={close} title={`Пригласить: ${name}`} size="md">
        {!result ? (
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-500 dark:text-neutral-400">
              Приглашение привяжется к карточке сотрудника — при входе доступ подключится автоматически.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="input w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Роль</label>
              <Select value={role} onChange={(v) => setRole(v as AppRole)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-ghost">Отмена</button>
              <button type="button" onClick={submit} disabled={busy} className="btn-primary">
                {busy ? "…" : "Пригласить"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            <p className="text-sm text-slate-700 dark:text-neutral-200">
              {result.emailed ? "Письмо с приглашением отправлено." : "Скопируйте ссылку и отправьте сотруднику:"}
            </p>
            {!result.emailed && (
              <>
                {result.note && <p className="text-xs text-amber-600 dark:text-amber-400">{result.note}</p>}
                <div className="flex items-center gap-2">
                  <input readOnly value={result.link} className="input w-full text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(result.link).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    className="btn-primary shrink-0 text-sm"
                  >
                    {copied ? "✓" : "Копировать"}
                  </button>
                </div>
              </>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={close} className="btn-ghost">Готово</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
