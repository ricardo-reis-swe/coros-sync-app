import { TriangleAlert, X } from 'lucide-react';
import { Notification } from './useMirror';

type NotifyStripProps = {
    toasts: Notification[];
    onDismiss: (id: number) => void;
};

// Overlays the bottom edge; transient by contract, so nothing here is ever state. (ADR-0013)
const NotifyStrip = ({ toasts, onDismiss }: NotifyStripProps) => (
    <div className="notify-strip">
        {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.level}`}>
                {toast.level === 'error' && <TriangleAlert size={14} />}
                <span>{toast.message}</span>
                <button className="row-icon" onClick={() => onDismiss(toast.id)}>
                    <X size={14} />
                </button>
            </div>
        ))}
    </div>
);

export default NotifyStrip;
