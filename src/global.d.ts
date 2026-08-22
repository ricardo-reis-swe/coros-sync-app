import { Ack, EventChannel, Intent } from './shared/ipc.types';

declare global {
    interface Window {
        api: {
            invoke(channel: Intent, payload: unknown): Promise<Ack>;
            subscribe(channel: EventChannel, fn: (payload: unknown) => void): () => void;
        };
    }
}
