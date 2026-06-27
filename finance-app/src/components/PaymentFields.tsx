"use client";

import { PAYMENT_METHODS, LEGAL_STATUSES, WALLET_NETWORKS } from "@/lib/constants";
import { Select } from "@/components/ui/select";

export type PaymentData = {
  payment_method: string;
  legal_status: string;
  payee_name: string;
  inn: string;
  bank_account: string;
  bank_name: string;
  bik: string;
  wallet_address: string;
  wallet_network: string;
};

export const emptyPayment: PaymentData = {
  payment_method: "bank",
  legal_status: "",
  payee_name: "",
  inn: "",
  bank_account: "",
  bank_name: "",
  bik: "",
  wallet_address: "",
  wallet_network: "TRC20",
};

export default function PaymentFields({
  value,
  onChange,
}: {
  value: PaymentData;
  onChange: (v: PaymentData) => void;
}) {
  function upd(k: keyof PaymentData, v: string) {
    onChange({ ...value, [k]: v });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Способ выплаты
        </label>
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => upd("payment_method", m.value)}
              className={`rounded-full px-3 py-1.5 font-medium transition ${
                value.payment_method === m.value
                  ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
                  : "text-slate-500 dark:text-neutral-400"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {value.payment_method === "bank" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <F label="ФИО получателя">
            <input value={value.payee_name} onChange={(e) => upd("payee_name", e.target.value)} placeholder="Иванов Иван Иванович" className="input" />
          </F>
          <F label="Статус">
            <Select value={value.legal_status ?? ""} onChange={(v) => upd("legal_status", v)} placeholder="— не указан —" options={[{ value: "", label: "— не указан —" }, ...LEGAL_STATUSES.map((s) => ({ value: s, label: s }))]} />
          </F>
          <F label="ИНН">
            <input value={value.inn} onChange={(e) => upd("inn", e.target.value)} placeholder="000000000000" className="input" />
          </F>
          <F label="Расчётный счёт (Р/С)">
            <input value={value.bank_account} onChange={(e) => upd("bank_account", e.target.value)} placeholder="40817…" className="input" />
          </F>
          <F label="Банк">
            <input value={value.bank_name} onChange={(e) => upd("bank_name", e.target.value)} placeholder="Т-Банк / Сбербанк…" className="input" />
          </F>
          <F label="БИК">
            <input value={value.bik} onChange={(e) => upd("bik", e.target.value)} placeholder="044525…" className="input" />
          </F>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <F label="Адрес кошелька">
            <input value={value.wallet_address} onChange={(e) => upd("wallet_address", e.target.value)} placeholder="TXxxx…" className="input" />
          </F>
          <F label="Сеть">
            <Select value={value.wallet_network ?? ""} onChange={(v) => upd("wallet_network", v)} options={WALLET_NETWORKS.map((n) => ({ value: n, label: n }))} />
          </F>
        </div>
      )}
    </div>
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
