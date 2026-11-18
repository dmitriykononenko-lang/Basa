import type { Metadata } from "next";
import IntakeClient from "@/components/intake/IntakeClient";

// Публичная страница «Передача доступа» для клиента KO Agency (без входа в Basa).
// Токен — во фрагменте адреса (#), страница читает его в браузере.
export const metadata: Metadata = {
  title: "KO Agency — передача доступа",
  description: "Защищённая передача доступа для KO Agency",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function IntakePage() {
  return <IntakeClient />;
}
