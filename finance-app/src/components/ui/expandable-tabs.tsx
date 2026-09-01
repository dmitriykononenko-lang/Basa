"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Иконка в стиле приложения (принимает className), а не строго LucideIcon —
// чтобы переиспользовать существующий набор @/components/icons.
type IconType = React.ComponentType<{ className?: string }>;

interface Tab {
  title: string;
  icon: IconType;
  type?: never;
}

interface Separator {
  type: "separator";
  title?: never;
  icon?: never;
}

type TabItem = Tab | Separator;

interface ExpandableTabsProps {
  tabs: TabItem[];
  className?: string;
  activeColor?: string;
  onChange?: (index: number | null) => void;
  /** Управляемый активный индекс (если задан — компонент не хранит своё состояние). */
  selected?: number | null;
}

function useOnClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: (e: MouseEvent | TouchEvent) => void
) {
  React.useEffect(() => {
    const listener = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      handler(e);
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

export function ExpandableTabs({
  tabs,
  className,
  activeColor = "text-primary",
  onChange,
  selected: controlled,
}: ExpandableTabsProps) {
  const isControlled = controlled !== undefined;
  const [internal, setInternal] = React.useState<number | null>(null);
  const selected = isControlled ? controlled : internal;
  const ref = React.useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, () => {
    if (!isControlled) {
      setInternal(null);
      onChange?.(null);
    }
  });

  const handleSelect = (index: number) => {
    if (!isControlled) setInternal(index);
    onChange?.(index);
  };

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-1.5 rounded-2xl border bg-background p-1 shadow-sm",
        className
      )}
    >
      {tabs.map((tab, index) => {
        if (tab.type === "separator") {
          return <div key={`sep-${index}`} className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
        }
        const Icon = tab.icon;
        const isSel = selected === index;
        return (
          <button
            key={tab.title}
            type="button"
            onClick={() => handleSelect(index)}
            className={cn(
              "relative flex items-center rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              isSel
                ? cn("bg-muted", activeColor)
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap transition-all duration-300",
                isSel ? "ml-2 max-w-[160px] opacity-100" : "ml-0 max-w-0 opacity-0"
              )}
            >
              {tab.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
