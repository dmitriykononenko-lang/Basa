"use client";

import Link from "next/link";
import { useMemo } from "react";
import { levelColor, levelName, initials, DEFAULT_BAND, LEVEL_COLORS } from "@/lib/assess";

export type ReportBlock = {
  key: string;
  name: string;
  band: number[];
  score: number;
  items: { name: string; score: number }[];
};

function shortName(name: string) {
  if (name === "Критическое мышление") return "Крит. мышл.";
  if (name === "Эмоциональный интеллект") return "Эмоц. инт.";
  return name;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

export default function AssessReport({
  subjectName,
  method,
  createdAt,
  blocks,
}: {
  subjectName: string;
  method: string;
  createdAt: string;
  blocks: ReportBlock[];
}) {
  const allItems = useMemo(
    () => blocks.flatMap((b) => b.items.map((it) => ({ ...it, block: b.name }))),
    [blocks],
  );
  const overall = allItems.length
    ? Math.round(allItems.reduce((s, it) => s + it.score, 0) / allItems.length)
    : 0;

  const sorted = useMemo(() => [...allItems].sort((a, b) => b.score - a.score), [allItems]);
  const strengths = sorted.slice(0, 5);
  const growth = sorted.slice(-5).reverse();

  const methodLabel = method === "self" ? "самооценка" : "тестирование";

  // Категории: сводная (Soft Skills) + по блокам.
  const chips = [
    { name: "Soft Skills", score: overall, band: DEFAULT_BAND },
    ...blocks.map((b) => ({ name: b.name, score: b.score, band: b.band })),
  ];

  // ------- Радар -------
  const cx = 210, cy = 195, R = 135, N = blocks.length;
  const pt = (i: number, r: number) => {
    const a = ((-90 + (i * 360) / N) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  const rings = [0.25, 0.5, 0.75, 1];
  const polygon = blocks
    .map((b, i) => {
      const p = pt(i, (R * b.score) / 100);
      return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link href="/assess" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100">
        ← Все оценки
      </Link>

      {/* Шапка */}
      <div className="surface flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl text-2xl font-bold text-white"
          style={{ background: "linear-gradient(135deg,#2f6df6,#6d5dfb)", boxShadow: "0 10px 24px -10px rgba(47,109,246,.6)" }}
        >
          {initials(subjectName)}
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-neutral-500">
            Отчёт оценки · Soft Skills
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            {subjectName}
          </h1>
          <div className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            {allItems.length} параметров · {blocks.length} блоков
          </div>
        </div>
        <div className="ml-auto text-right text-xs leading-relaxed text-slate-400 dark:text-neutral-500">
          Метод: {methodLabel}
          <br />
          Дата: {fmtDate(createdAt)}
          <br />
          Шкала: 5 уровней
        </div>
      </div>

      {/* Категории */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {chips.map((c) => {
          const col = levelColor(c.score, c.band);
          return (
            <div key={c.name} className="surface p-4">
              <div className="min-h-[2.4em] text-[11.5px] leading-tight text-slate-500 dark:text-neutral-400">
                {c.name}
              </div>
              <div className="mt-2 font-mono text-3xl font-semibold leading-none tracking-tight" style={{ color: col }}>
                {c.score}
              </div>
              <div className="mt-1 text-[11px] font-semibold" style={{ color: col }}>
                {levelName(c.score, c.band)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Радар + параметры */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[0.92fr_1.4fr]">
        <div className="surface p-5 sm:p-6">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Профиль по блокам</h2>
          <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">Сводные баллы блоков (0–100).</p>
          <svg viewBox="0 0 420 380" className="h-auto w-full">
            {rings.map((f, ri) => (
              <polygon
                key={ri}
                points={blocks.map((_, i) => { const p = pt(i, R * f); return `${p[0].toFixed(1)},${p[1].toFixed(1)}`; }).join(" ")}
                fill="none"
                stroke="currentColor"
                className="text-slate-200 dark:text-white/10"
              />
            ))}
            {blocks.map((b, i) => {
              const p = pt(i, R);
              const o = pt(i, 0);
              const lp = pt(i, R + 18);
              const anchor = lp[0] > cx + 4 ? "start" : lp[0] < cx - 4 ? "end" : "middle";
              return (
                <g key={b.key}>
                  <line x1={o[0]} y1={o[1]} x2={p[0]} y2={p[1]} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
                  <text x={lp[0]} y={lp[1]} fontSize="10" textAnchor={anchor} dominantBaseline="middle" fill="currentColor" className="text-slate-500 dark:text-neutral-400">
                    {shortName(b.name)} {b.score}
                  </text>
                </g>
              );
            })}
            <polygon points={polygon} fill="rgba(47,109,246,.16)" stroke="#2f6df6" strokeWidth="2" />
            {blocks.map((b, i) => {
              const p = pt(i, (R * b.score) / 100);
              return <circle key={b.key} cx={p[0]} cy={p[1]} r="3" fill="#2f6df6" />;
            })}
          </svg>
        </div>

        <div className="surface p-5 sm:p-6">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Параметры по блокам</h2>
          <p className="mb-2 text-xs text-slate-400 dark:text-neutral-500">
            Цвет = уровень по шкале блока (у блоков разные пороги).
          </p>
          {blocks.map((b) => (
            <div key={b.key}>
              <div className="mb-1.5 mt-4 flex items-baseline justify-between border-b border-slate-100 pb-1.5 first:mt-0 dark:border-white/[0.07]">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-neutral-200">{b.name}</span>
                <span className="font-mono text-[11px] text-slate-400 dark:text-neutral-500">блок · {b.score}/100</span>
              </div>
              {b.items.map((it) => {
                const col = levelColor(it.score, b.band);
                return (
                  <div key={it.name} className="grid grid-cols-[130px_1fr_30px] items-center gap-3 py-1 sm:grid-cols-[190px_1fr_34px]">
                    <div className="truncate text-[12.5px] text-slate-600 dark:text-neutral-300" title={it.name}>{it.name}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${it.score}%`, background: col }} />
                    </div>
                    <div className="text-right font-mono text-[12.5px] font-semibold" style={{ color: col }}>{it.score}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Сильные стороны / зоны роста */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="surface p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLORS[5] }} />
            Сильные стороны
          </h3>
          <ul className="flex flex-col gap-2">
            {strengths.map((x) => (
              <li key={x.name} className="text-[13px] text-slate-700 dark:text-neutral-200">
                <span className="font-medium">{x.name}</span> — <span style={{ color: levelColor(x.score) }}>{x.score}</span>{" "}
                <span className="text-slate-400 dark:text-neutral-500">({x.block})</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="surface p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLORS[1] }} />
            Зоны роста
          </h3>
          <ul className="flex flex-col gap-2">
            {growth.map((x) => (
              <li key={x.name} className="text-[13px] text-slate-700 dark:text-neutral-200">
                <span className="font-medium">{x.name}</span> — <span style={{ color: levelColor(x.score) }}>{x.score}</span>{" "}
                <span className="text-slate-400 dark:text-neutral-500">({x.block})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
