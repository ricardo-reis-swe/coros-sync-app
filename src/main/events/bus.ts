/** The domain reports upward without knowing a BrowserWindow exists; three events. (ADR-0004) */

export type Notification = { level: 'info' | 'error'; message: string };

export type ProgressDelta =
    | { itemId: string; completed: number; expected: number }
    | { transfer: { done: number; total: number } }
    // A third shape, not a fourth channel: confirmed downloads, `null` ends the batch. (ADR-0027)
    | { download: { done: number; total: number } | null };

const changedListeners = new Set<() => void>();
const notifyListeners = new Set<(notification: Notification) => void>();
const progressListeners = new Set<(delta: ProgressDelta) => void>();

export const onChanged = (listener: () => void): (() => void) => {
    changedListeners.add(listener);
    return () => changedListeners.delete(listener);
};

// A snapshot is a full rebuild, so a 300-file wipe emitting per file is 300 of them. (ADR-0039)
const COALESCE_MS = 50;
let limiter: ReturnType<typeof setTimeout> | null = null;
let missed = false;

// Leading edge with a trailing flush: the LAST change always lands, and a snapshot carries no delta. (ADR-0039)
export const emitChanged = (): void => {
    if (limiter) {
        missed = true;
        return;
    }

    changedListeners.forEach((listener) => listener());

    limiter = setTimeout(() => {
        limiter = null;
        // Re-entered, not fired directly: more may have arrived, so the limiter re-arms.
        if (missed) {
            missed = false;
            emitChanged();
        }
    }, COALESCE_MS);
};

export const onNotify = (listener: (notification: Notification) => void): (() => void) => {
    notifyListeners.add(listener);
    return () => notifyListeners.delete(listener);
};

export const emitNotify = (notification: Notification): void => {
    notifyListeners.forEach((listener) => listener(notification));
};

export const onProgress = (listener: (delta: ProgressDelta) => void): (() => void) => {
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
};

// High-frequency, never durable: a count of confirmed things, not a percentage.
export const emitProgress = (delta: ProgressDelta): void => {
    progressListeners.forEach((listener) => listener(delta));
};
