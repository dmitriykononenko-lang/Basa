"use client";

import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/ui/date-range-picker";

/** Пикер произвольного периода для отчётов: навигирует на ?period=custom&from&to */
export default function ReportRangePicker({
  basePath,
  from,
  to,
}: {
  basePath: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  return (
    <DateRangePicker
      from={from}
      to={to}
      onChange={(f, t) => {
        const params = new URLSearchParams({ period: "custom" });
        if (f) params.set("from", f);
        if (t) params.set("to", t);
        router.push(`${basePath}?${params.toString()}`);
      }}
    />
  );
}
