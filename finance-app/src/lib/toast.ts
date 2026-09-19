// Лёгкие тосты без провайдера: любой клиентский компонент вызывает toast(...),
// а <Toaster/> в layout слушает события и рисует стек уведомлений.

export type ToastKind = "success" | "error" | "info";
export type ToastDetail = { id: number; message: string; kind: ToastKind };

let counter = 0;

export function toast(message: string, kind: ToastKind = "success") {
  if (typeof window === "undefined") return;
  const detail: ToastDetail = { id: ++counter, message, kind };
  window.dispatchEvent(new CustomEvent("app-toast", { detail }));
}

toast.success = (m: string) => toast(m, "success");
toast.error = (m: string) => toast(m, "error");
toast.info = (m: string) => toast(m, "info");
