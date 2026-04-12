import { useEffect } from 'react';

export type ToastData = {
  id: string;
  message: string;
  type: 'buy' | 'sell' | 'info' | 'reward' | 'publish' | 'error';
};

type Props = {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
};

const toastIcons: Record<ToastData['type'], string> = {
  buy: '',
  sell: '',
  info: '',
  reward: '',
  publish: '',
  error: '',
};

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3800);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast toast-${toast.type}`} role="alert">
      <span className="toast-icon">{toastIcons[toast.type]}</span>
      <span className="toast-msg">{toast.message}</span>
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)}>✕</button>
    </div>
  );
}

export default function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}
