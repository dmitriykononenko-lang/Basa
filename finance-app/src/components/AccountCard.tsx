"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";

export type AccountFull = {
  id: string;
  name: string;
  currency: string;
  kind: string;
  archived: boolean;
  number: string | null;
  bank_name: string | null;
  bik: string | null;
  corr_account: string | null;
  legal_entity: string | null;
  account_group: string | null;
  opening_balance: number;
  opening_date: string | null;
};

export default function AccountCard({
  open,
  onClose,
  account,
  balance,
  entities,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  account: AccountFull;
  balance: number;
  entities: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [group, setGroup] = useState(account.account_group ?? "");
  const [entity, setEntity] = useState(account.legal_entity ?? "");
  const [bank, setBank] = useState(account.bank_name ?? "");
  const [bik, setBik] = useState(account.bik ?? "");
  const [corr, setCorr] = useState(account.corr_account ?? "");
  const [number, setNumber] = useState(account.number ?? "");
  const [opening, setOpening] = useState(String((account.opening_balance / 100).toFixed(2)).replace(".", ","));
  const [openingDate, setOpeningDate] = useState(account.opening_date ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Укажите название счёта");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("accounts")
      .update({
        name: name.trim(),
        account_group: group.trim() || null,
        legal_entity: entity.trim() || null,
        bank_name: bank.trim() || null,
        bik: bik.trim() || null,
        corr_account: corr.trim() || null,
        number: number.trim() || null,
        opening_balance: parseMoney(opening),
        opening_date: openingDate || null,
      })
      .eq("id", account.id);
    setBusy(false);
    if (error) return setError(error.message);
    toast.success("Счёт сохранён");
    onClose();
    router.refresh();
  }

  async function toggleArchive() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("accounts").update({ archived: !account.archived, closed: !account.archived }).eq("id", account.id);
    setBusy(false);
    if (error) return setError(error.message);
    toast.success(account.archived ? "Счёт открыт" : "Счёт закрыт");
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить счёт? Это возможно только если по нему нет операций.")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("accounts").delete().eq("id", account.id);
    setBusy(false);
    if (error) return setError("Удалить нельзя: по счёту есть операции. Используйте «Закрыть счёт».");
    toast.success("Счёт удалён");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Банковский счёт · ${balance < 0 ? "−" : ""}${Math.abs(balance / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ${account.currency}`} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <F label="Название счёта"><input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="input" /></F>
        <F label="Группа счетов"><input value={group} onChange={(e) => setGroup(e.target.value)} disabled={!canEdit} className="input" placeholder="—" /></F>
        <F label="Юр. лицо">
          <input value={entity} onChange={(e) => setEntity(e.target.value)} disabled={!canEdit} className="input" placeholder="ИП / ООО…" list="entities-list" />
          <datalist id="entities-list">{entities.map((e) => <option key={e} value={e} />)}</datalist>
        </F>
        <F label="Банк"><input value={bank} onChange={(e) => setBank(e.target.value)} disabled={!canEdit} className="input" /></F>
        <F label="БИК"><input value={bik} onChange={(e) => setBik(e.target.value)} disabled={!canEdit} className="input" /></F>
        <F label="Корр. счёт (к/с)"><input value={corr} onChange={(e) => setCorr(e.target.value)} disabled={!canEdit} className="input" /></F>
        <F label="Номер счёта"><input value={number} onChange={(e) => setNumber(e.target.value)} disabled={!canEdit} className="input" /></F>
        <F label="Валюта счёта"><input value={account.currency} disabled className="input opacity-60" /></F>
        <F label="Начальный остаток"><input value={opening} onChange={(e) => setOpening(e.target.value)} disabled={!canEdit} className="input" /></F>
        <F label="Дата начального остатка"><input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} disabled={!canEdit} className="input" /></F>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {canEdit && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button onClick={toggleArchive} disabled={busy} className="ml-auto rounded-full px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:text-neutral-300 dark:ring-white/[0.1] dark:hover:bg-neutral-800">
            {account.archived ? "Открыть счёт" : "Закрыть счёт"}
          </button>
          <button onClick={remove} disabled={busy} className="rounded-full px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40">
            Удалить
          </button>
        </div>
      )}
    </Modal>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
