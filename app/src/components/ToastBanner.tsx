// app/src/components/ToastBanner.tsx
import { X } from "lucide-react";
import type { ToastNotice } from "../types/studio";

interface ToastBannerProps {
  toasts: ToastNotice[];
  onDismiss: (id: string) => void;
}

export function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item ${toast.tone}`}>
          <span>{toast.message}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onDismiss(toast.id)}
            aria-label="Fechar aviso"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
