import { IconRegulation, IconArticle, IconChecklist } from "@/components/icons";
import type { KbKind } from "@/lib/kb";

export default function KindIcon({ kind, className }: { kind: KbKind; className?: string }) {
  const I = kind === "checklist" ? IconChecklist : kind === "article" ? IconArticle : IconRegulation;
  return <I className={className} />;
}
