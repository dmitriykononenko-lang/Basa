"use client";

import { useMemo } from "react";
import { LIKERT, type AssessBlock, type AssessCompetency, type AssessItem } from "@/lib/assess";

// Презентационный опросник: блоки → компетенции → пункты, шкала Ликерта 1–5.
// Реверс-пункты не помечаются (учитываются на сервере при подсчёте).
export default function LikertTest({
  blocks,
  competencies,
  items,
  answers,
  onAnswer,
}: {
  blocks: AssessBlock[];
  competencies: AssessCompetency[];
  items: AssessItem[];
  answers: Record<string, number>;
  onAnswer: (itemId: string, v: number) => void;
}) {
  const compsByBlock = useMemo(() => {
    const m = new Map<string, AssessCompetency[]>();
    for (const c of competencies) {
      const arr = m.get(c.block_id) ?? [];
      arr.push(c);
      m.set(c.block_id, arr);
    }
    return m;
  }, [competencies]);

  const itemsByComp = useMemo(() => {
    const m = new Map<string, AssessItem[]>();
    for (const it of items) {
      const arr = m.get(it.competency_id) ?? [];
      arr.push(it);
      m.set(it.competency_id, arr);
    }
    return m;
  }, [items]);

  return (
    <div className="flex flex-col gap-6">
      {blocks.map((b) => {
        const comps = compsByBlock.get(b.id) ?? [];
        return (
          <section key={b.id} className="surface overflow-hidden">
            <header className="border-b border-slate-100 px-5 py-3.5 dark:border-white/[0.07]">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{b.name}</h2>
            </header>
            <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {comps.map((c) => {
                const its = itemsByComp.get(c.id) ?? [];
                return (
                  <div key={c.id} className="px-5 py-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand">{c.name}</div>
                    <div className="flex flex-col gap-4">
                      {its.map((it) => (
                        <div key={it.id} id={`item-${it.id}`} className="scroll-mt-24">
                          <div className="mb-2 text-sm text-slate-700 dark:text-neutral-200">{it.text}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {LIKERT.map((label, idx) => {
                              const v = idx + 1;
                              const active = answers[it.id] === v;
                              return (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => onAnswer(it.id, v)}
                                  title={label}
                                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                    active
                                      ? "border-brand bg-brand text-white"
                                      : "border-slate-200 text-slate-500 hover:border-brand/50 hover:text-slate-800 dark:border-white/10 dark:text-neutral-400 dark:hover:text-neutral-100"
                                  }`}
                                >
                                  <span className="sm:hidden">{v}</span>
                                  <span className="hidden sm:inline">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
