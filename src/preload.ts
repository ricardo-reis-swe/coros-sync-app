import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, EventChannel, Intent, INTENT_CHANNELS } from './shared/ipc.types';

contextBridge.exposeInMainWorld('api', {
    invoke: (channel: Intent, payload: unknown) => {
        if (!INTENT_CHANNELS.includes(channel)) {
            throw Error('Event Channel not found');
        }

        return ipcRenderer.invoke(channel, payload);
    },
    subscribe: (channel: EventChannel, fn: (payload: unknown) => void) => {
        if (!EVENT_CHANNELS.includes(channel)) {
            throw Error('Event Channel not found');
        }

        const wrapped = (_event: IpcRendererEvent, payload: unknown) => fn(payload);

        ipcRenderer.on(channel, wrapped);

        return () => ipcRenderer.removeListener(channel, wrapped);
    },
});
