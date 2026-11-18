"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Тонкая полоса прогресса, которая «пробегает» при смене страницы
export default function NavProgress() {
  const pathname = usePathname();
  const [key, setKey] = useState(0);

  useEffect(() => {
    setKey((k) => k + 1);
  }, [pathname]);

  if (key === 0) return null;

  return (
    <div
      key={key}
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 origin-left animate-[navbar_0.6s_ease-out_forwards] bg-brand"
    />
  );
}
