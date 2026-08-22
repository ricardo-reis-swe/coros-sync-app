import { useEffect, useRef, useState } from 'react';
import { Intent, StateSnapshot } from '../shared/ipc.types';

export type Notification = { id: number; level: 'info' | 'error'; message: string };
export type ItemProgress = { completed: number; expected: number };
type Transfer = { done: number; total: number };
type Download = { done: number; total: number };

type ProgressDelta =
    | ({ itemId: string } & ItemProgress)
    | { transfer: Transfer }
    // A third shape on the same channel; a fourth channel is forbidden. (ADR-0013)
    | { download: Download | null };

const TOAST_MS = 6000;
const ERROR_MAX = 3;
const INFO_MAX = 2;

/** Per level, in order: an info is a confirmation and must never evict an error. (ADR-0013) */
const capped = (open: Notification[]): Notification[] => {
    const newest = (level: Notification['level'], max: number) =>
        open.filter((toast) => toast.level === level).slice(-max);

    const kept = new Set([...newest('error', ERROR_MAX), ...newest('info', INFO_MAX)]);
    return open.filter((toast) => kept.has(toast));
};

/** Set by `useMirror`, so a rejected Ack has somewhere to go without every caller awaiting one. */
let reportRejection: ((message: string) => void) | null = null;

export const invoke = (channel: Intent, payload: unknown = {}) =>
    window.api.invoke(channel, payload).then((ack) => {
        // The Ack is the Gateway's validation result; discarding it hides a malformed intent. (ADR-0011)
        if (!ack.ok) reportRejection?.(`${channel} was refused: ${ack.error.message}`);
        return ack;
    });

export const useMirror = () => {
    // The mirror has exactly one writer: this handler. Intent never touches it. (ADR-0011)
    const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
    const [progress, setProgress] = useState<Record<string, ItemProgress>>({});
    const [transfer, setTransfer] = useState<Transfer | null>(null);
    const [download, setDownload] = useState<Download | null>(null);
    const [toasts, setToasts] = useState<Notification[]>([]);
    const nextToastId = useRef(0);

    const dismiss = (id: number) => setToasts((open) => open.filter((toast) => toast.id !== id));

    const push = (level: Notification['level'], message: string) => {
        const id = nextToastId.current++;
        setToasts((open) => capped([...open, { id, level, message }]));
        // Transient by contract: a toast that never leaves is persisted state. (ADR-0013)
        if (level === 'info') setTimeout(() => dismiss(id), TOAST_MS);
    };

    useEffect(() => {
        const off = [
            window.api.subscribe('state:snapshot', (payload) =>
                setSnapshot(payload as StateSnapshot),
            ),
            window.api.subscribe('progress:delta', (payload) => {
                const delta = payload as ProgressDelta;
                if ('transfer' in delta) setTransfer(delta.transfer);
                else if ('download' in delta) setDownload(delta.download);
                else setProgress((all) => ({ ...all, [delta.itemId]: delta }));
            }),
            window.api.subscribe('notify', (payload) => {
                const { level, message } = payload as Omit<Notification, 'id'>;
                push(level, message);
            }),
        ];

        // A refused intent is a bug or a stale click, so it reads as an error, not a notify.
        reportRejection = (message) => push('error', message);

        void invoke('hydrate');

        return () => {
            reportRejection = null;
            off.forEach((unsubscribe) => unsubscribe());
        };
    }, []);

    // Deltas are not durable, so they are dropped the moment the item leaves `processing`.
    useEffect(() => {
        if (!snapshot) return;
        const running = new Set(
            snapshot.items.filter((item) => item.state === 'processing').map((item) => item.id),
        );
        setProgress((all) => {
            const kept = Object.entries(all).filter(([itemId]) => running.has(itemId));
            return kept.length === Object.keys(all).length ? all : Object.fromEntries(kept);
        });
    }, [snapshot]);

    // Nothing else clears it: the session's count outlives its last delta by one snapshot.
    useEffect(() => {
        if (snapshot && !snapshot.device.syncing) setTransfer(null);
    }, [snapshot?.device.syncing]);

    return { snapshot, progress, transfer, download, toasts, dismiss };
};
