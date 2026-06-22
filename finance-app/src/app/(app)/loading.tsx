import { ProgressiveFluxLoader } from "@/components/ui/progressive-flux-loader";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6 py-16">
      <ProgressiveFluxLoader
        duration={8}
        phases={[
          { at: 0, label: "загрузка" },
          { at: 45, label: "считаем цифры" },
          { at: 80, label: "почти готово" },
          { at: 100, label: "готово" },
        ]}
      />
    </div>
  );
}
