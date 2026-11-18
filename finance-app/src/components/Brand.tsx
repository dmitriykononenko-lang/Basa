// Фирменный знак: тёмный квадрат с «B» + слово, оранжевая точка-акцент (как у Slider)
export default function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-[13px] font-bold text-white dark:bg-white dark:text-neutral-900">
        B
      </span>
      <span className="text-[15px] font-bold tracking-tight text-neutral-900 dark:text-white">
        asa
        <span className="text-accent">.</span>
      </span>
    </div>
  );
}
