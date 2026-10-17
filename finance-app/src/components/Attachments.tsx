"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type Attachment = {
  id: string;
  storage_path: string;
  file_name: string;
};

export default function Attachments({
  teamId,
  transactionId,
  userId,
  items,
  canEdit,
}: {
  teamId: string;
  transactionId: string;
  userId: string;
  items: Attachment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function view(path: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUrl(path, 60);
    if (error) {
      setError(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${teamId}/${transactionId}/${Date.now()}-${safe}`;

    const { error: upErr } = await supabase.storage
      .from("receipts")
      .upload(path, file);
    if (upErr) {
      setError(upErr.message);
      setBusy(false);
      return;
    }
    const { error: insErr } = await supabase.from("attachments").insert({
      team_id: teamId,
      transaction_id: transactionId,
      storage_path: path,
      file_name: file.name,
      created_by: userId,
    });
    if (insErr) {
      setError(insErr.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  async function remove(att: Attachment) {
    setBusy(true);
    const supabase = createClient();
    await supabase.storage.from("receipts").remove([att.storage_path]);
    await supabase.from("attachments").delete().eq("id", att.id);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500 dark:text-neutral-400">
        Чеки и вложения
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {items.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs dark:bg-neutral-800"
          >
            <button
              onClick={() => view(a.storage_path)}
              className="max-w-[160px] truncate text-slate-700 hover:text-brand dark:text-neutral-200"
              title={a.file_name}
            >
              📎 {a.file_name}
            </button>
            {canEdit && (
              <button
                onClick={() => remove(a)}
                disabled={busy}
                className="rounded-full px-1.5 text-slate-400 hover:text-red-500"
              >
                ✕
              </button>
            )}
          </span>
        ))}

        {canEdit && (
          <label className="inline-flex cursor-pointer items-center rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/20">
            {busy ? "Загрузка…" : "+ файл"}
            <input
              type="file"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
          </label>
        )}
        {items.length === 0 && !canEdit && (
          <span className="text-xs text-slate-400">нет</span>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
