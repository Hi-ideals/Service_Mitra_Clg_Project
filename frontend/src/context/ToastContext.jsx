/**
 * Transient feedback.
 *
 * Toasts are for confirming something happened, never for errors a user must
 * act on - those belong inline, next to the thing that failed.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, { variant = 'success', duration = 4000 } = {}) => {
      const id = ++nextId;
      setToasts((current) => [...current, { id, message, variant }]);

      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }

      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      toasts,
      dismiss,
      toast: {
        success: (m, o) => push(m, { ...o, variant: 'success' }),
        error: (m, o) => push(m, { ...o, variant: 'error', duration: 6000 }),
        info: (m, o) => push(m, { ...o, variant: 'info' }),
      },
    }),
    [toasts, dismiss, push],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context.toast;
}

export function useToastState() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToastState must be used inside a ToastProvider');
  return { toasts: context.toasts, dismiss: context.dismiss };
}

export default ToastContext;
