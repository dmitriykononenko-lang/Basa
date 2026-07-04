"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import {
  PERIOD_LABELS,
  DIRECTION_LABELS,
  AGG_LABELS,
  type Metric,
  type MetricPeriod,
  type MetricDirection,
  type MetricAgg,
} from "@/lib/metrics";
import type { OwnerOption } from "./MetricsView";

export default function MetricEditor({
  open,
  onClose,
  teamId,
  metric,
  owners,
  unitOptions,
}: {
  open: boolean;
  onClose: () => void;
  teamId: string;
  metric: Metric | null;
  owners: OwnerOption[];
  unitOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(metric?.name ?? "");
  const [unit, setUnit] = useState(metric?.unit ?? "");
  const [period, setPeriod] = useState<MetricPeriod>(metric?.period ?? "week");
  const [direction, setDirection] = useState<MetricDirection>(metric?.direction ?? "up_good");
  const [aggregation, setAggregation] = useState<MetricAgg>(metric?.aggregation ?? "last");
  const [plan, setPlan] = useState(metric?.plan != null ? String(metric.plan) : "");
  const [owner, setOwner] = useState(metric?.owner_user_id ?? "");
  const [unitId, setUnitId] = useState(metric?.unit_id ?? "");
  const [active, setActive] = useState(metric?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Укажите название показателя");
      return;
    }
    const planNum = plan.trim() === "" ? null : Number(plan.replace(",", "."));
    if (planNum != null && !Number.isFinite(planNum)) {
      toast.error("План — число");
      return;
    }
    setBusy(true);
    const payload = {
      team_id: teamId,
      name: name.trim(),
      unit: unit.trim(),
      period,
      direction,
      aggregation,
      plan: planNum,
      owner_user_id: owner || null,
      unit_id: unitId || null,
      is_active: active,
    };
    const { error } = metric
      ? await supabase.from("metrics").update(payload).eq("id", metric.id)
      : await supabase.from("metrics").insert({ ...payload, created_by: (await supabase.auth.getUser()).data.user?.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(metric ? "Показатель обновлён" : "Показатель создан");
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!metric) return;
    if (!confirm(`Удалить показатель «${metric.name}» со всеми значениями?`)) return;
    setBusy(true);
    const { error } = await supabase.from("metrics").delete().eq("id", metric.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Показатель удалён");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={metric ? "Показатель" : "Новый показатель"} size="lg">
      <div className="space-y-4 p-5">
        <Field label="Название">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="Напр. Выручка, Сделок закрыто" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Единица измерения">
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className="input w-full" placeholder="₽, шт, %" />
          </Field>
          <Field label="План (целевое значение)">
            <input value={plan} onChange={(e) => setPlan(e.target.value)} className="input w-full" placeholder="напр. 1000000" inputMode="decimal" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Период">
            <Select value={period} onChange={(v) => setPeriod(v as MetricPeriod)} options={(Object.keys(PERIOD_LABELS) as MetricPeriod[]).map((k) => ({ value: k, label: PERIOD_LABELS[k] }))} />
          </Field>
          <Field label="Направление">
            <Select value={direction} onChange={(v) => setDirection(v as MetricDirection)} options={(Object.keys(DIRECTION_LABELS) as MetricDirection[]).map((k) => ({ value: k, label: DIRECTION_LABELS[k] }))} />
          </Field>
          <Field label="Свод за период">
            <Select value={aggregation} onChange={(v) => setAggregation(v as MetricAgg)} options={(Object.keys(AGG_LABELS) as MetricAgg[]).map((k) => ({ value: k, label: AGG_LABELS[k] }))} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ответственный">
            <Select value={owner} onChange={setOwner} placeholder="— не назначен —" options={[{ value: "", label: "— не назначен —" }, ...owners.map((o) => ({ value: o.user_id, label: o.name }))]} />
          </Field>
          <Field label="Отдел / узел">
            <Select value={unitId} onChange={setUnitId} placeholder="— не привязан —" options={[{ value: "", label: "— не привязан —" }, ...unitOptions]} />
          </Field>
        </div>

        {metric && (
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Активен (показывается в списке)
          </label>
        )}

        <div className="flex items-center justify-between pt-2">
          {metric ? (
            <button onClick={remove} disabled={busy} className="text-sm text-red-500 hover:underline disabled:opacity-50">
              Удалить
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Отмена</button>
            <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
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
