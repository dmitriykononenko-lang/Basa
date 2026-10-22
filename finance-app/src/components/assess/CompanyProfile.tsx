"use client";

import { levelColor, levelName, DEFAULT_BAND, LEVEL_COLORS } from "@/lib/assess";

export type CompanyBlock = { key: string; name: string; band: number[]; score: number };
export type CompanyData = {
  participants: number;
  overall: number;
  blocks: CompanyBlock[];
  strengths: { name: string; score: number; block: string }[];
  gaps: { name: string; score: number; block: string }[];
};

function shortName(name: string) {
  if (name === "Критическое мышление") return "Крит. мышл.";
  if (name === "Эмоциональный интеллект") return "Эмоц. инт.";
  return name;
}

export default function CompanyProfile({ company }: { company: CompanyData }) {
  const { blocks, overall, participants } = company;
  const col = levelColor(overall, DEFAULT_BAND);

  // Радар по блокам
  const cx = 210, cy = 195, R = 135, N = blocks.length;
  const pt = (i: number, r: number) => {
    const a = ((-90 + (i * 360) / N) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  const polygon = blocks.map((b, i) => { const p = pt(i, (R * b.score) / 100); return `${p[0].toFixed(1)},${p[1].toFixed(1)}`; }).join(" ");

  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-neutral-500">
            Профиль компании
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Средний профиль команды</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
            По {participants} завершённым оценкам сотрудников
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-semibold leading-none" style={{ color: col }}>{overall}</div>
          <div className="mt-0.5 text-[11px] font-semibold" style={{ color: col }}>{levelName(overall, DEFAULT_BAND)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Радар */}
        <svg viewBox="0 0 420 380" className="h-auto w-full">
          {[0.25, 0.5, 0.75, 1].map((f, ri) => (
            <polygon key={ri} points={blocks.map((_, i) => { const p = pt(i, R * f); return `${p[0].toFixed(1)},${p[1].toFixed(1)}`; }).join(" ")} fill="none" stroke="currentColor" className="text-slate-200 dark:text-white/10" />
          ))}
          {blocks.map((b, i) => {
            const p = pt(i, R), o = pt(i, 0), lp = pt(i, R + 18);
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
          <polygon points={polygon} fill="rgba(109,93,251,.16)" stroke="#6d5dfb" strokeWidth="2" />
          {blocks.map((b, i) => { const p = pt(i, (R * b.score) / 100); return <circle key={b.key} cx={p[0]} cy={p[1]} r="3" fill="#6d5dfb" />; })}
        </svg>

        {/* Сильные стороны / зоны роста команды */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-neutral-200">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLORS[5] }} />
              Сильные стороны команды
            </h3>
            <ul className="flex flex-col gap-1.5">
              {company.strengths.map((x) => (
                <li key={x.name} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-slate-700 dark:text-neutral-200">{x.name} <span className="text-slate-400 dark:text-neutral-500">({x.block})</span></span>
                  <span className="shrink-0 font-mono font-semibold" style={{ color: levelColor(x.score) }}>{x.score}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-neutral-200">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLORS[1] }} />
              Зоны роста команды
            </h3>
            <ul className="flex flex-col gap-1.5">
              {company.gaps.map((x) => (
                <li key={x.name} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-slate-700 dark:text-neutral-200">{x.name} <span className="text-slate-400 dark:text-neutral-500">({x.block})</span></span>
                  <span className="shrink-0 font-mono font-semibold" style={{ color: levelColor(x.score) }}>{x.score}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
