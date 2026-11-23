import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';
import { ToastContext, type ToastType } from './ToastContext';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-success shrink-0" />,
  error: <AlertCircle className="h-5 w-5 text-danger shrink-0" />,
  info: <Info className="h-5 w-5 text-primary shrink-0" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-full max-w-sm px-4" role="log" aria-live="polite">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className="flex items-center gap-3 bg-surface border border-border rounded-[var(--radius-card)] px-4 py-3 shadow-[var(--shadow-lg)]"
      style={{ animation: 'slide-up 200ms ease-out both' }}
    >
      {icons[toast.type]}
      <p className="text-sm text-ink flex-1">{toast.message}</p>
      <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss" className="text-muted hover:text-ink shrink-0 cursor-pointer">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
