"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

export default function ProfileSecurity({ email }: { email: string }) {
  const supabase = useRef(createClient()).current;
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  async function changeEmail() {
    const v = newEmail.trim().toLowerCase();
    if (!v || v === email.toLowerCase()) {
      toast.error("Введите новый email");
      return;
    }
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email: v });
    setEmailBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Письмо для подтверждения отправлено на новый адрес");
    setNewEmail("");
  }

  async function changePassword() {
    if (pwd.length < 6) {
      toast.error("Пароль не короче 6 символов");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("Пароли не совпадают");
      return;
    }
    setPwdBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setPwdBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Пароль изменён");
    setPwd("");
    setPwd2("");
  }

  return (
    <div className="surface rounded-3xl p-6">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Вход и безопасность</h2>

      <div className="mt-5">
        <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Текущий email</span>
        <div className="text-sm text-slate-800 dark:text-neutral-200">{email}</div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Новый email</span>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="input w-full"
            placeholder="new@example.com"
          />
        </label>
        <button onClick={changeEmail} disabled={emailBusy} className="btn-ghost disabled:opacity-50">
          {emailBusy ? "…" : "Сменить email"}
        </button>
      </div>

      <div className="mt-6 border-t border-slate-100 pt-5 dark:border-white/[0.07]">
        <span className="mb-2 block text-xs font-medium text-slate-500 dark:text-neutral-400">Сменить пароль</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            className="input w-full"
            placeholder="Новый пароль"
            autoComplete="new-password"
          />
          <input
            type="password"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            className="input w-full"
            placeholder="Повторите пароль"
            autoComplete="new-password"
          />
          <button onClick={changePassword} disabled={pwdBusy} className="btn-ghost shrink-0 disabled:opacity-50">
            {pwdBusy ? "…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
