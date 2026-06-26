"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { IconSearch } from "@/components/icons";
import { KB_KIND_LABELS, KB_STATUS_LABELS, type KbKind, type KbStatus } from "@/lib/kb";

export default function KbFilters() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const kind = sp.get("kind") ?? "";
  const status = sp.get("status") ?? "";

  function setParam(patch: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    router.push(qs ? `/knowledge-base?${qs}` : "/knowledge-base");
  }

  const active = q || kind || status;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ q, kind, status });
        }}
        className="relative"
      >
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию"
          className="input w-56 pl-9"
        />
      </form>
      <Select
        variant="pill"
        value={kind}
        onChange={(v) => setParam({ q, kind: v, status })}
        options={[{ value: "", label: "Все типы" }, ...(Object.keys(KB_KIND_LABELS) as KbKind[]).map((k) => ({ value: k, label: KB_KIND_LABELS[k] }))]}
      />
      <Select
        variant="pill"
        value={status}
        onChange={(v) => setParam({ q, kind, status: v })}
        options={[{ value: "", label: "Все статусы" }, ...(Object.keys(KB_STATUS_LABELS) as KbStatus[]).map((s) => ({ value: s, label: KB_STATUS_LABELS[s] }))]}
      />
      {active && (
        <button type="button" onClick={() => { setQ(""); setParam({ q: "", kind: "", status: "" }); }} className="text-sm text-slate-400 hover:text-brand">
          Сбросить
        </button>
      )}
    </div>
  );
}
