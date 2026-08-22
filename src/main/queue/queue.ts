export type Entry = {
    groupKey: string;
    run: (signal: AbortSignal) => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    controller?: AbortController;
};

export class CancelledError extends Error {
    groupKey: string;
    constructor(groupKey: string) {
        super(`Task cancelled (group: ${groupKey})`);
        this.name = 'CancelledError';
        this.groupKey = groupKey;
    }
}

export const createAsyncQueue = (getLimit: () => number) => {
    const queue: Entry[] = [];
    const runningSet = new Set<Entry>();

    const isAborted = (entry: Entry) => {
        if (entry.controller?.signal.aborted) {
            entry.reject(new CancelledError(entry.groupKey));
            return true;
        }
        return false;
    };

    const next = () => {
        while (runningSet.size < getLimit() && queue.length > 0) {
            const task = queue.shift();
            if (!task) return;
            const controller = new AbortController();

            const taskToStart = { ...task, controller };
            runningSet.add(taskToStart);
            const { run, resolve, reject } = taskToStart;

            Promise.resolve()
                .then(() => run(controller.signal))
                .then(
                    (value) => {
                        if (!isAborted(taskToStart)) {
                            return resolve(value);
                        }
                    },
                    (reason) => {
                        if (!isAborted(taskToStart)) {
                            return reject(reason);
                        }
                    },
                )
                .finally(() => {
                    runningSet.delete(taskToStart);
                    next();
                });
        }
    };

    const submit = async <R>(groupKey: string, run: (signal: AbortSignal) => Promise<R>) => {
        return new Promise<R>((resolve, reject) => {
            queue.push({
                groupKey,
                run,
                resolve,
                reject,
            } as Entry);
            next();
        });
    };

    const cancelGroup = (groupKey: string) => {
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].groupKey === groupKey) {
                const [entry] = queue.splice(i, 1);
                entry.reject(new CancelledError(groupKey));
            }
        }

        runningSet.forEach((element) => {
            if (element.groupKey === groupKey) {
                element.controller?.abort();
            }
        });
    };

    return { submit, cancelGroup };
};
