"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import EmptyState from "@/components/EmptyState";
import ExportButton from "@/components/ExportButton";
import { Select } from "@/components/ui/select";
import MetricEditor from "./MetricEditor";
import {
  achievement,
  formatMetric,
  periodLabel,
  PERIOD_LABELS,
  metricStatus,
  STATE_LABELS,
  stateColor,
  type Metric,
  type MetricPeriod,
  type MetricStatus,
} from "@/lib/metrics";

export type OwnerOption = { user_id: string; name: string };
export type UnitOption = { id: string; name: string; parent_id: string | null };

export type MetricWithData = Metric & {
  ownerName: string | null;
  unitName: string | null;
  series: { period_start: string; value: number | null }[];
  current: number | null;
  currentPeriodStart: string;
};

// Дот-матрица для крупных чисел (как в витрине). С @supports-фолбэком:
// без поддержки background-clip:text цифры остаются обычными.
const DOT_CSS = `@supports ((-webkit-background-clip:text) or (background-clip:text)){
  .dotnum{background-image:radial-gradient(circle at 50% 50%,currentColor 42%,transparent 46%);
  background-size:.14em .14em;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
}`;

// Индентированные подписи узлов оргструктуры (дерево по parent_id).
function buildUnitOptions(units: UnitOption[]): { value: string; label: string }[] {
  const children = new Map<string | null, UnitOption[]>();
  for (const u of units) {
    const arr = children.get(u.parent_id) ?? [];
    arr.push(u);
    children.set(u.parent_id, arr);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const out: { value: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of children.get(parent) ?? []) {
      out.push({ value: u.id, label: `${"— ".repeat(depth)}${u.name}` });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function MetricsView({
  metrics,
  owners,
  units,
  uid,
  teamId,
  canManage,
}: {
  metrics: MetricWithData[];
  owners: OwnerOption[];
  units: UnitOption[];
  uid: string | null;
  teamId: string;
  canManage: boolean;
}) {
  const supabase = useState(() => createClient())[0];
  const [items, setItems] = useState<MetricWithData[]>(metrics);
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Metric | null>(null);

  const unitOptions = useMemo(() => buildUnitOptions(units), [units]);
  const hasMine = !!uid && items.some((m) => m.owner_user_id === uid);

  // Авто-состояние каждой метрики + счётчики сверху.
  const statuses = useMemo(() => new Map(items.map((m) => [m.id, metricStatus(m.series, m)])), [items]);
  const activeItems = useMemo(() => items.filter((m) => m.is_active), [items]);
  const growingCount = activeItems.filter((m) => statuses.get(m.id)?.trend === "up").length;
  const fallingCount = activeItems.filter((m) => statuses.get(m.id)?.trend === "down").length;

  const visible = items.filter((m) => {
    if (tab === "mine" && m.owner_user_id !== uid) return false;
    if (tab === "all" && !m.is_active) return false;
    if (unitFilter && m.unit_id !== unitFilter) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function saveValue(m: MetricWithData, raw: string) {
    const v = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(v)) {
      toast.error("Введите число");
      return;
    }
    const { error } = await supabase
      .from("metric_values")
      .upsert(
        { team_id: m.team_id, metric_id: m.id, period_start: m.currentPeriodStart, value: v, entered_by: uid },
        { onConflict: "metric_id,period_start" },
      );
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? {
              ...x,
              current: v,
              series: x.series.map((p) => (p.period_start === m.currentPeriodStart ? { ...p, value: v } : p)),
            }
          : x,
      ),
    );
    toast.success("Сохранено");
  }

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(m: Metric) {
    setEditing(m);
    setEditorOpen(true);
  }

  return (
    <div className="p-6 sm:p-8">
      <style dangerouslySetInnerHTML={{ __html: DOT_CSS }} />
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Показатели</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Метрики и статистика: план/факт по периодам</p>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <ExportButton
              filename="metrics.csv"
              headers={["Показатель", "Период", "Факт", "План", "%", "Ответственный", "Отдел"]}
              rows={items.map((m) => {
                const a = achievement(m.current, m.plan, m.direction);
                return [m.name, PERIOD_LABELS[m.period as MetricPeriod], m.current ?? "", m.plan ?? "", a.pct != null ? Math.round(a.pct) : "", m.ownerName ?? "", m.unitName ?? ""];
              })}
            />
          )}
          {canManage && <button onClick={openCreate} className="btn-primary">+ Показатель</button>}
        </div>
      </header>

      {/* Счётчики состояния (авто) — стиль витрины */}
      {items.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <CounterCard label="Активные метрики" value={activeItems.length} tone="ink" />
          <CounterCard label="Растущие" value={growingCount} tone="good" />
          <CounterCard label="Падающие" value={fallingCount} tone="warn" />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {hasMine && (
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
            <TabBtn active={tab === "all"} onClick={() => setTab("all")}>Все</TabBtn>
            <TabBtn active={tab === "mine"} onClick={() => setTab("mine")}>Мои показатели</TabBtn>
          </div>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск…"
          className="input h-9 w-44"
        />
        {units.length > 0 && (
          <div className="w-56">
            <Select
              value={unitFilter}
              onChange={setUnitFilter}
              placeholder="Все отделы"
              variant="pill"
              options={[{ value: "", label: "Все отделы" }, ...unitOptions]}
            />
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="📊"
          title={items.length === 0 ? "Показателей пока нет" : "Ничего не найдено"}
          description={items.length === 0 ? "Создайте первый показатель кнопкой «+ Показатель»: выручка, сделки, скорость ответа — что важно отслеживать." : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => (
            <MetricCard
              key={m.id}
              m={m}
              status={statuses.get(m.id)!}
              canEnter={canManage || m.owner_user_id === uid}
              canManage={canManage}
              onSaveValue={(raw) => saveValue(m, raw)}
              onEdit={() => openEdit(m)}
            />
          ))}
        </ul>
      )}

      {canManage && (
        <MetricEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          teamId={teamId}
          metric={editing}
          owners={owners}
          unitOptions={unitOptions}
        />
      )}
    </div>
  );
}

function CounterCard({ label, value, tone }: { label: string; value: number; tone: "ink" | "good" | "warn" }) {
  const map = {
    ink: { color: "text-slate-900 dark:text-white", grad: "from-slate-500/[0.06]" },
    good: { color: "text-emerald-600 dark:text-emerald-400", grad: "from-emerald-500/[0.12]" },
    warn: { color: "text-amber-600 dark:text-amber-400", grad: "from-amber-500/[0.12]" },
  }[tone];
  return (
    <div className="surface relative overflow-hidden rounded-3xl p-5">
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t ${map.grad} to-transparent`} />
      <div className={`dotnum relative text-[46px] font-bold leading-none tabular-nums ${map.color}`}>{String(value).padStart(2, "0")}</div>
      <div className="relative mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{label}</div>
    </div>
  );
}

function StateBadge({ state }: { state: MetricStatus["state"] }) {
  const c = stateColor(state);
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: c, background: `${c}1a` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {STATE_LABELS[state]}
    </span>
  );
}

function MetricCard({
  m,
  status,
  canEnter,
  canManage,
  onSaveValue,
  onEdit,
}: {
  m: MetricWithData;
  status: MetricStatus;
  canEnter: boolean;
  canManage: boolean;
  onSaveValue: (raw: string) => Promise<void>;
  onEdit: () => void;
}) {
  const [input, setInput] = useState(m.current != null ? String(m.current) : "");
  const [saving, setSaving] = useState(false);
  const { pct, good } = achievement(m.current, m.plan, m.direction);

  async function submit() {
    setSaving(true);
    await onSaveValue(input);
    setSaving(false);
  }

  const valueColor =
    good == null ? "text-slate-900 dark:text-white" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  return (
    <li className="surface flex flex-col rounded-3xl p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/metrics/${m.id}`} className="block truncate font-semibold text-slate-900 transition hover:text-brand dark:text-white">{m.name}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
            <StateBadge state={status.state} />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">{PERIOD_LABELS[m.period as MetricPeriod]}</span>
            {m.unitName && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">{m.unitName}</span>}
            {m.ownerName && <span>· {m.ownerName}</span>}
          </div>
        </div>
        {canManage && (
          <button onClick={onEdit} aria-label="Настроить" className="shrink-0 text-slate-300 transition hover:text-slate-500">
            ⚙
          </button>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className={`dotnum text-[32px] font-bold leading-none tabular-nums ${valueColor}`}>{formatMetric(m.current, m.unit)}</div>
          {m.plan != null && (
            <div className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
              план {formatMetric(m.plan, m.unit)}
              {pct != null && <span className={`ml-1 font-medium ${good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>· {Math.round(pct)}%</span>}
            </div>
          )}
        </div>
        <Sparkline series={m.series} color={stateColor(status.state)} />
      </div>

      {m.plan != null && pct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
          <div className={`h-full rounded-full ${good ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      )}

      {canEnter && (
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
          <span className="shrink-0 text-[11px] text-slate-400 dark:text-neutral-500">{periodLabel(m.currentPeriodStart, m.period as MetricPeriod)}</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            inputMode="decimal"
            placeholder="факт"
            className="input h-8 w-full text-sm"
          />
          <button onClick={submit} disabled={saving} className="btn-ghost shrink-0 px-3 py-1.5 text-sm disabled:opacity-50">
            {saving ? "…" : "✓"}
          </button>
        </div>
      )}
    </li>
  );
}

function Sparkline({ series, color }: { series: { period_start: string; value: number | null }[]; color: string }) {
  const pts = series.map((p) => p.value).filter((v): v is number => v != null);
  if (pts.length < 2) return <div className="h-8 w-20" />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const W = 80, H = 32;
  const step = series.length > 1 ? W / (series.length - 1) : W;
  let lastY = H / 2;
  const coords = series.map((p, i) => {
    const x = i * step;
    if (p.value == null) return null;
    lastY = H - ((p.value - min) / span) * H;
    return `${x.toFixed(1)},${lastY.toFixed(1)}`;
  }).filter(Boolean) as string[];
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 font-medium transition ${active ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}
    >
      {children}
    </button>
  );
}
