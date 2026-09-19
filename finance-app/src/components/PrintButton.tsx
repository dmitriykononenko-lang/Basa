"use client";

export default function PrintButton({ label = "Сохранить в PDF" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn-primary no-print">
      🖶 {label}
    </button>
  );
}
