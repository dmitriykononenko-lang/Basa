"use client";

import { useState } from "react";
import { parseTimecode, type Timecode } from "@/lib/kb-video";

// Видео урока (Loom) с кликабельными тайм-кодами. Клик по тайм-коду
// перезагружает iframe с параметром ?t=<сек> — Loom стартует с нужного места.
export default function LessonVideo({ embedUrl, timecodes }: { embedUrl: string; timecodes: Timecode[] }) {
  const [sec, setSec] = useState<number | null>(null);
  const src = sec != null ? `${embedUrl}?t=${sec}` : embedUrl;
  const valid = timecodes
    .map((tc) => ({ tc, s: parseTimecode(tc.t) }))
    .filter((x): x is { tc: Timecode; s: number } => x.s != null);

  return (
    <div className="surface rounded-3xl p-4">
      <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ paddingTop: "56.25%" }}>
        <iframe
          key={sec ?? "start"}
          src={src}
          title="Видео урока"
          allowFullScreen
          allow="fullscreen; picture-in-picture"
          className="absolute inset-0 h-full w-full"
        />
      </div>
      {valid.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {valid.map(({ tc, s }, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSec(s)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition ${
                sec === s
                  ? "bg-brand/10 text-brand ring-1 ring-brand/30"
                  : "bg-slate-100 text-slate-600 hover:bg-brand/10 hover:text-brand dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              <span className="font-mono font-medium text-brand">{tc.t}</span>
              <span>{tc.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
