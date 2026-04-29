"use client";

// Lightweight shadcn/ui-compatible Toast.
//
// API mirrors `useToast()` from shadcn so swapping in the full library later
// is a one-import diff. Single-instance provider; toasts auto-dismiss after
// 4.5s unless `duration: 0` is passed.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { classNames } from "@/lib/format";

export type ToastVariant = "default" | "success" | "warning" | "destructive";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms; 0 = sticky
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => string;
  dismiss: (id?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id?: string) => {
    setToasts((cur) => (id ? cur.filter((t) => t.id !== id) : []));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const duration = t.duration ?? 4500;
      setToasts((cur) => [...cur, { ...t, id }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}

function Toaster() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
      role="region"
      aria-label="Notifications"
    >
      {ctx.toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => ctx.dismiss(t.id)} />
      ))}
    </div>
  );
}

const ICON: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
};

const ACCENT: Record<ToastVariant, string> = {
  default: "border-white/15 text-slate-200",
  success: "border-mint/40 text-mint",
  warning: "border-amber-400/40 text-amber-300",
  destructive: "border-coral/40 text-coral",
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const variant = toast.variant ?? "default";
  const Icon = ICON[variant];
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className={classNames(
        "glass rounded-xl shadow-glow px-4 py-3 border transition-all duration-200",
        ACCENT[variant],
        entered ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm">{toast.title}</div>
          {toast.description && (
            <div className="text-xs text-slate-300 mt-0.5">{toast.description}</div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-500 hover:text-white shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
