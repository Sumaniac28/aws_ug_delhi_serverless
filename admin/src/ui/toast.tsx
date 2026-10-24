import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
}

const ToastContext = createContext<{ show: (message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((message: string) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-40 grid max-w-sm gap-2">
        {toasts.map((t) => (
          <p key={t.id} className="pointer-events-auto rounded-md border border-border bg-foreground px-4 py-3 font-bold text-background">
            {t.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v.show;
}
