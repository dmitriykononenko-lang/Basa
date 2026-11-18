"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function ProfileForm({
  userId,
  teamId,
  initialName,
  initialAvatar,
}: {
  userId: string;
  teamId: string | null;
  initialName: string;
  initialAvatar: string | null;
}) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    if (!name.trim()) {
      toast.error("Укажите имя");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim(), avatar_url: avatar })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Профиль обновлён");
    router.refresh();
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!teamId) {
      toast.error("Загрузка аватара доступна только в команде");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Нужен файл изображения");
      return;
    }
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${teamId}/avatars/${userId}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("kb-media").upload(path, file, {
      cacheControl: "31536000",
      upsert: false,
      contentType: file.type || undefined,
    });
    setUploading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAvatar(supabase.storage.from("kb-media").getPublicUrl(path).data.publicUrl);
    toast.info("Аватар загружен — не забудьте сохранить");
  }

  return (
    <div className="surface rounded-3xl p-6">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Профиль</h2>
      <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Имя и фото видят коллеги в команде.</p>

      <div className="mt-5 flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand text-lg font-semibold text-white">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(name || "?")
          )}
        </span>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || !teamId}
            className="btn-ghost text-sm disabled:opacity-50"
          >
            {uploading ? "Загрузка…" : "Загрузить фото"}
          </button>
          {avatar && (
            <button type="button" onClick={() => setAvatar(null)} className="text-xs text-slate-400 hover:text-red-500">
              Убрать фото
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
        </div>
      </div>

      <label className="mt-5 block">
        <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Имя</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-full"
          placeholder="Как вас зовут"
        />
      </label>

      <div className="mt-4">
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
