export const ITEM_STATES = ['imported', 'processing', 'processed', 'ready'] as const;
export type ItemStateType = (typeof ITEM_STATES)[number];

export const ITEM_TYPE = ['media', 'audiobook'] as const;
export type ItemType = (typeof ITEM_TYPE)[number];

export const SETTINGS = [
    'bitrateMedia',
    'bitrateAudiobook',
    'splitEveryMin',
    'concurrency',
    'logLevel',
    'mountPath',
    // Which of an output's two names is written to the watch, per type. (ADR-0040)
    'renameMedia',
    'renameAudiobook',
    // The user's own yt-dlp, when the bundled one has rotted. (ADR-0055)
    'ytdlpPath',
] as const;
export type SettingsType = (typeof SETTINGS)[number];

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** What the renderer sees: `setting ?? codeDefault` already applied in main. (ADR-0024) */
export type EffectiveSettings = {
    bitrateMedia: number;
    bitrateAudiobook: number;
    splitEveryMin: number;
    concurrency: number;
    logLevel: LogLevel;
    mountPath: string | null;
    renameMedia: boolean;
    renameAudiobook: boolean;
    ytdlpPath: string | null;
};

export type Item = {
    id: string;
    state: ItemStateType;
    groupId: string;
    groupName: string;
    sourcePath: string;
    type: ItemType;
    title?: string;
    author?: string;
    bitrate?: number;
    splitEveryMin?: number;
    orderIndex: number;
};

export type Output = {
    id: string;
    itemId: string;
    filePath: string;
    chapterIndex?: number;
    chapterTitle?: string;
    partIndex: number;
    deviceFilename: string;
    // The undecorated sibling. Both are immutable; sync picks one, never composes. (ADR-0040)
    deviceFilenamePlain: string;
    onWatch: boolean;
};

export type Settings = Record<SettingsType, string>;

/** One scanned file. No size: the scan has it, nothing renders it. (ADR-0028) */
export type DeviceEntry = {
    filename: string;
    managed: boolean;
};

/** A boolean could not hold the third case: mounted, listed by the picker, forbidden. (ADR-0045) */
export type DeviceReach = 'ok' | 'unreachable' | 'denied';

export type DeviceState = {
    reach: DeviceReach;
    syncing: boolean;
    // Published, not inferred: the renderer cannot know a stop is pending until the file lands. (ADR-0025)
    stopping: boolean;
    freeBytes: number | null;
    // The device's own directory order — ADR-0004's premise, rendered rather than assumed.
    files: DeviceEntry[];
};
