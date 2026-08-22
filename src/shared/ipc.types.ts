import { DeviceState, EffectiveSettings, Item, ItemType, LogLevel, Output } from './data.types';

export const INTENT_CHANNELS = [
    'import',
    // The second way in: bytes first, row after, then the ordinary pipeline. (ADR-0027)
    'importUrls',
    'cancelDownloads',
    'updateItem',
    'process',
    'cancelProcessing',
    'stage',
    // `stage` backwards, and nothing else: the row leaves column 3, the mp3s stay. (ADR-0047)
    'unstage',
    // The way back out of `processed`/`ready`: outputs deleted, item re-editable. (ADR-0033)
    'revertItems',
    // Order is a user decision and outlives the window that expressed it. (ADR-0030)
    'reorder',
    // Library only; there is deliberately no `deleteOutput`. (ADR-0022)
    'deleteItems',
    'sync',
    // Stops a running transfer between files — not `cancelProcessing`'s job. (ADR-0025)
    'cancelSync',
    'scanDevice',
    'selectDeviceFolder',
    // The OS unmounts it; the app only asks, and only when it is not writing. (ADR-0034)
    'ejectDevice',
    'deleteFromDevice',
    'getSettings',
    'updateSettings',
    'openLogFolder',
    'copyLogs',
    'openAppData',
    'hydrate',
] as const;
export type Intent = (typeof INTENT_CHANNELS)[number];

export type Ack =
    { ok: true; requestId: string } | { ok: false; error: { code: string; message: string } };

export const EVENT_CHANNELS = ['state:snapshot', 'progress:delta', 'notify'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export type StateSnapshot = {
    requestId?: string;
    items: Item[];
    outputs: Output[];
    device: DeviceState;
    // Settings are state — mirrored and re-stated — so they ride this channel. (ADR-0024)
    settings: EffectiveSettings;
};

export type IpcImportPayload = {
    type: ItemType;
    isFolder: boolean;
};

export type IpcProcessPayload = {
    itemIds: string[];
};

/** The one renderer-supplied string main opens — scheme-checked, because a URL is not a path. (ADR-0027) */
export type IpcImportUrlsPayload = {
    urls: string[];
};

/** `type` is carried though the ids imply it: it makes "drag never crosses a cell" checkable. */
export type IpcReorderPayload = {
    type: ItemType;
    ordered: string[];
};

export type IpcSyncPayload = {
    // Playback order, always — and the order main writes in, because the player follows it. (ADR-0044)
    mode: 'append-new' | 'reorder-all';
    ordered: string[];
};

/** Filenames, not Output ids: an `unmanaged` file has no row to name. (ADR-0029) */
export type IpcDeleteFromDevicePayload = {
    filenames: string[];
};

/** Title only. `author` is the app's to write, not the user's — it carries the tag. */
export type IpcUpdateItemPayload = {
    itemId: string;
    title: string;
};

/** `null` clears a key back to its code default. An absent key is left alone. */
export type IpcUpdateSettingsPayload = Partial<
    Record<'bitrateMedia' | 'bitrateAudiobook' | 'splitEveryMin' | 'concurrency', number | null>
> & {
    logLevel?: LogLevel | null;
    mountPath?: string | null;
    ytdlpPath?: string | null;
    renameMedia?: boolean | null;
    renameAudiobook?: boolean | null;
};
