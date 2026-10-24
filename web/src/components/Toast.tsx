import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[min(380px,calc(100vw-40px))] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className="fade-up flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-sm shadow-[var(--shadow-md)]"
          >
            {item.kind === "success" ? (
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--success)]" />
            ) : item.kind === "error" ? (
              <XCircle size={17} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            ) : (
              <Info size={17} className="mt-0.5 shrink-0 text-[var(--accent-strong)]" />
            )}
            <span className="flex-1 leading-relaxed">{item.message}</span>
            <button
              className="text-[var(--muted-2)] hover:text-[var(--ink)]"
              onClick={() => setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))}
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
